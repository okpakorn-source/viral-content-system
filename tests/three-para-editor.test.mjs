// 📝 ข้อสอบขั้น บก.สามย่อหน้า (ขั้นสุดท้าย · 4 พ.ย. 69) — จำลองโมเดล ไม่ยิง API จริง
//   A. สวิตช์ปิดค่าเริ่มต้น · ต่อท่อในบล็อก บก.จัดหน้า · ปิด = เรียกตัวเดิม
//   B. จัดย่อหน้าด้วยโค้ด: เปลี่ยนแค่ช่องว่าง ไม่แบ่งเอง · จัดวรรคตอนนอกคำพูด ไม่แตะในคำพูด
//   C. ด่านโค้ด: ตัวเลข+หน่วย คำพูด คำอังกฤษ คำสำคัญ คำใหม่ คำหาย ความยาว จำนวนย่อหน้า อีโมจิ (ตารางเคสของผู้ตรวจอิสระรอบ 1 ต้องถูกตีตก)
//   D. ทั้งชุด: ผ่าน = ถ้อยคำใหม่ · ไม่ผ่าน/ความหมายเปลี่ยน/ตรวจล้ม/ผลตรวจแปลก/ตรวจซ้ำแย่ลง = ถ้อยคำเดิมจัดด้วยโค้ด · ถอยทุกชั้น = ฉบับเดิมทุกไบต์
//   E. เวลา: เหลือน้อย = ไม่เรียกโมเดล แต่ยังจัดย่อหน้า · ส่ง signal ถึงโมเดลและตัวตรวจ
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': `${ROOT}src` }, interopDefault: true });
const TP = await jiti.import(`${ROOT}src/lib/services/threeParaEditor.js`);
const AF = await jiti.import(`${ROOT}src/lib/services/autoFlowServiceText.js`);
const { annotateMissingRawFacts } = await jiti.import(`${ROOT}src/lib/services/rawFactPresence.js`);
const { neutralizeGuessedGender } = await jiti.import(`${ROOT}src/lib/services/genderNeutral.js`);
const { createPipelineDeadline, runWithPipelineDeadline } = await jiti.import(`${ROOT}src/lib/utils/pipelineDeadline.js`);

// ข้อสอบส่วนใหญ่ทดสอบเส้นทางที่เรียก AI (โมเดลจำลอง) · ค่าเริ่มต้นจริงคือปิด ทดสอบที่ D10
process.env.THREE_PARA_AI = '1';

const withEnv = async (vars, fn) => {
  const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

// ข่าวสมมติ (ไม่ใช่ข่าวจริง) ยาวเกินขั้นต่ำ 146 คำ
const P1 = 'เกรด 3.95 แต่แทบไม่มีเงินค่ารถไปโรงเรียน วันนี้ "น้องมะลิ ใจดี" ได้เป็นพยาบาลประจำโรงพยาบาลชุมชนบ้านนา หลังจากที่ต้องเรียนไปทำงานไปตลอดหลายปีที่ผ่านมาโดยไม่เคยบ่นให้ใครฟังเลยแม้แต่ครั้งเดียว';
const P2 = 'กว่าจะมาถึงวันนี้ พ่อป่วยหนักต้องฟอกไตสัปดาห์ละ 2 ครั้ง แม่รับจ้างทั่วไปได้วันละ 300 บาท โรงเรียนอยู่ไกล 40 กิโลเมตร น้องต้องยืมเงินเพื่อนบ้านเป็นค่ารถเกือบทุกสัปดาห์ จนครูประจำชั้นส่งเรื่องขอทุนให้ และน้องได้ทุนเรียนต่อจนจบ ทั้งที่หลายคนบอกให้ออกมาทำงานช่วยที่บ้านตั้งแต่ยังเรียนไม่จบ แต่น้องก็เลือกเรียนต่อและกลับมาอ่านหนังสือทุกคืนหลังเลิกงานจนได้เกรดดีที่สุดของรุ่น';
const P3 = 'น้องบอกว่า "หนูอยากกลับมาดูแลคนในหมู่บ้านที่เคยช่วยหนู" วันนี้ความฝันนั้นเป็นจริงแล้ว และคนทั้งหมู่บ้านก็ภูมิใจในตัวน้องมากจริงๆ แต่น้องไม่เคยลืมว่าตัวเองมาจากไหน และยังกลับมาเยี่ยมคุณครูคนเดิมทุกครั้งที่มีวันหยุดจากโรงพยาบาล';
const curly = (s) => s.replace(/"([^"]+)"/g, '“$1”');
const BEFORE = curly([P1, P2, P3].join('\n\n'));
const REWRITE = BEFORE.replace('จนครูประจำชั้นส่งเรื่องขอทุนให้ และน้องได้ทุนเรียนต่อจนจบ', 'จนครูประจำชั้นส่งเรื่องขอทุนให้ แล้วน้องได้ทุนเรียนต่อจนจบ');
const reply = (post) => `<understanding>น้องมะลิเรียนเก่งแต่ยากจน</understanding>\n<issues>แก้คำเชื่อม</issues>\n<post>\n${post}\n</post>`;
const version = (content, extra = {}) => ({ title: 'หัวข่าวเดิม', content, promptId: 'p1', usedModel: 'claude-fable-5-1', _source: 'classic', ...extra });
const passCheck = async () => ({ issues: [] });
const [C1, C2, C3] = BEFORE.split('\n\n');
const FOUR = [C1, C2, 'ย่อหน้ากลางเพิ่มเติม', C3].join('\n\n');
const PACKED = [C1, `${C2} ย่อหน้ากลางเพิ่มเติม`, C3].join('\n\n');
const REWRITE4 = PACKED.replace('จนครูประจำชั้นส่งเรื่องขอทุนให้ และน้องได้ทุนเรียนต่อจนจบ', 'จนครูประจำชั้นส่งเรื่องขอทุนให้ แล้วน้องได้ทุนเรียนต่อจนจบ');
const pad = (s) => `${s}\n\nย่อหน้าสองเหมือนเดิม\n\nย่อหน้าสามเหมือนเดิม`;

test('A1 สวิตช์ปิดค่าเริ่มต้น · เปิดเฉพาะ THREE_PARA_EDIT=1', async () => {
  await withEnv({ THREE_PARA_EDIT: undefined }, () => assert.equal(TP.isThreeParaEditEnabled(), false));
  await withEnv({ THREE_PARA_EDIT: 'true' }, () => assert.equal(TP.isThreeParaEditEnabled(), false));
  await withEnv({ THREE_PARA_EDIT: '0' }, () => assert.equal(TP.isThreeParaEditEnabled(), false));
  await withEnv({ THREE_PARA_EDIT: '1' }, () => assert.equal(TP.isThreeParaEditEnabled(), true));
  await withEnv({ THREE_PARA_EDIT: ' "1" ' }, () => assert.equal(TP.isThreeParaEditEnabled(), true));
});

test('A2 ต่อท่อ: อยู่ในบล็อก บก.จัดหน้า · ปิดสวิตช์เรียกตัวเดิม · ส่งข่าวดิบ + ตัวตรวจซ้ำชุดเดียวกัน', () => {
  const src = readFileSync(`${ROOT}src/lib/services/autoFlowServiceText.js`, 'utf8');
  const block = src.slice(src.indexOf('isLayoutEditEnabled() &&'), src.indexOf('countFinalVersionSources(finalVersions)'));
  assert.match(block, /isThreeParaEditEnabled\(\)\s*\?\s*await runThreeParaEdit\(finalVersions, \{ rawText, recheck: _layoutRecheck \}\)\s*:\s*await runLayoutEdit\(finalVersions, \{ rawText, recheck: _layoutRecheck \}\)/);
});

test('A3 ตรวจย้อนได้: บันทึกฉบับก่อนแก้ลง pipeline_info เฉพาะเมื่อมีฉบับจากขั้นนี้', () => {
  const src = readFileSync(`${ROOT}src/lib/services/autoFlowServiceText.js`, 'utf8');
  assert.match(src, /threePara: finalVersions\.some\(\(version\) => version\._layoutEdit\?\.mode === 'three_para'\)/);
  assert.match(src, /pre: version\._preLayoutContent \|\| null/);
  assert.match(src, /lightIssues: version\._layoutEdit\.lightDetails \|\| \[\]/, 'ต้องเก็บข้อความจุดเบา ไม่ใช่แค่จำนวน');
  const logger = readFileSync(`${ROOT}src/lib/services/generationLogger.js`, 'utf8');
  assert.match(logger, /\.\.\.\(pipelineInfo\.threePara \? \{ threePara: pipelineInfo\.threePara \} : \{\}\)/);
});

test('B1 จัดย่อหน้าด้วยโค้ด: 3 เดิม = เดิม · เกิน = รวมย่อหน้ากลาง · ขึ้นบรรทัดในย่อหน้า = เว้นวรรค · ไม่เปลี่ยนตัวอักษร', () => {
  assert.equal(TP.packIntoThreeParagraphs(BEFORE), BEFORE);
  const six = 'หนึ่ง\nต่อ\n\nสอง\n\nสาม\nต่อ\n\nสี่\n\nห้า\n\nหก';
  assert.equal(TP.packIntoThreeParagraphs(six), 'หนึ่ง ต่อ\n\nสอง สาม ต่อ สี่ ห้า\n\nหก');
  const squeeze = (s) => s.replace(/\s+/g, '');
  assert.equal(squeeze(TP.packIntoThreeParagraphs(six)), squeeze(six));
});

test('B2 จัดย่อหน้าด้วยโค้ด: น้อยกว่า 3 = คงจำนวนเดิม ไม่แบ่งเอง (ผู้ตรวจ: "นานกว่า 20 ¶ ปี" · "แม่ไม่ได้ทิ้ง ¶ ลูกไปทำงาน")', () => {
  assert.equal(TP.packIntoThreeParagraphs('หนึ่ง สอง\n\nสาม สี่'), 'หนึ่ง สอง\n\nสาม สี่');
  assert.equal(TP.packIntoThreeParagraphs('แม่ไม่ได้ทิ้ง ลูกไปทำงาน นานกว่า 20 ปี'), 'แม่ไม่ได้ทิ้ง ลูกไปทำงาน นานกว่า 20 ปี');
  assert.equal(TP.packIntoThreeParagraphs(''), '');
});

test('B3 วรรคตอนด้วยโค้ด: ตัด .. … · เว้นรอบคำพูด · ไม้ยมก · คำย่อ · ไม่แตะข้อความในคำพูด', () => {
  assert.equal(TP.tidyThaiPunctuation('ให้มูลนิธิ ..เธอจึงขอโอกาส'), 'ให้มูลนิธิ เธอจึงขอโอกาส');
  assert.equal(TP.tidyThaiPunctuation('จบแล้ว...จริง'), 'จบแล้ว จริง');
  assert.equal(TP.tidyThaiPunctuation('จบแล้ว…จริง'), 'จบแล้ว จริง');
  assert.equal(TP.tidyThaiPunctuation('ราคา 2..5 ล้าน'), 'ราคา 2..5 ล้าน', 'จุดระหว่างตัวเลขห้ามตัด ไม่งั้นตัวเลขเปลี่ยน');
  assert.equal(TP.tidyThaiPunctuation('ทำไม“ต้า”ถึงไม่เคย'), 'ทำไม “ต้า” ถึงไม่เคย');
  assert.equal(TP.tidyThaiPunctuation('ร.ต.ท.สมภพ เมื่อ 9 ต.ค.2569'), 'ร.ต.ท. สมภพ เมื่อ 9 ต.ค. 2569');
  assert.equal(TP.tidyThaiPunctuation('ร.ต.ท. สมภพ และ พล.ต.อ. สมชาย'), 'ร.ต.ท. สมภพ และ พล.ต.อ. สมชาย', 'คำย่อที่เว้นถูกแล้ว ห้ามหั่น (เคสจริง: ร.ต. ท. สมภพ)');
  assert.equal(TP.tidyThaiPunctuation('พล.ต.อ.สมชาย'), 'พล.ต.อ. สมชาย');
  assert.equal(TP.tidyThaiPunctuation('ล้วนๆแล้ว จริง ๆ'), 'ล้วนๆ แล้ว จริงๆ');
  assert.equal(TP.tidyThaiPunctuation('จริงๆๆ เลย'), 'จริงๆๆ เลย', 'ไม้ยมกซ้อนห้ามแยก');
  assert.equal(TP.tidyThaiPunctuation('ดีมาก!! จริงหรือ??'), 'ดีมาก! จริงหรือ?');
  assert.equal(TP.tidyThaiPunctuation('เขาว่า “หนู...ไม่รู้ ๆ!!” แล้วจบ'), 'เขาว่า “หนู...ไม่รู้ ๆ!!” แล้วจบ', 'ในคำพูดต้องเหมือนเดิม');
  assert.equal(TP.tidyThaiPunctuation('เขาว่า ‘หนู...ไม่รู้ ๆ!!’ แล้วจบ'), 'เขาว่า ‘หนู...ไม่รู้ ๆ!!’ แล้วจบ', 'คำพูดแบบเดี่ยวก็ต้องเหมือนเดิม');
  assert.equal(TP.tidyThaiPunctuation('ค่า 19.00 น. และ 1,500 บาท'), 'ค่า 19.00 น. และ 1,500 บาท', 'ตัวเลขไม่เปลี่ยน');
  assert.equal(TP.tidyThaiPunctuation('หนึ่ง\n\nสอง'), 'หนึ่ง\n\nสอง', 'คงย่อหน้า');
});

test('B4 เครื่องหมายคำพูด: ซ่อมคู่ปิดผิดข้าง · ไม่เว้นวรรคติดวงเล็บ/เครื่องหมาย · หน่วยนิ้วไม่ใช่เครื่องหมายเปิด', () => {
  assert.equal(TP.tidyThaiPunctuation('เขาบอกว่า “ไม่แต่งก็ได้นะ“ แล้วเดินออกไป'), 'เขาบอกว่า “ไม่แต่งก็ได้นะ” แล้วเดินออกไป');
  assert.equal(TP.tidyThaiPunctuation('เขาบอกว่า "ไม่แต่งก็ได้นะ" แล้วเดินออกไป'), 'เขาบอกว่า “ไม่แต่งก็ได้นะ” แล้วเดินออกไป');
  assert.equal(TP.tidyThaiPunctuation('(“รักเธอ”)'), '(“รักเธอ”)');
  assert.equal(TP.tidyThaiPunctuation('“รัก”: ใจ'), '“รัก”: ใจ');
  assert.equal(TP.tidyThaiPunctuation('“รัก”, ใจ'), '“รัก”, ใจ');
  assert.equal(TP.tidyThaiPunctuation('จอ 17" และ "ดีมาก" จบ'), 'จอ 17" และ “ดีมาก” จบ');
  assert.deepEqual(TP.quotesOf('“ถ้าไม่โอเค ไม่แต่งก็ได้นะ“ แล้ว ‘จริง’'), ['ถ้าไม่โอเคไม่แต่งก็ได้นะ', 'จริง']);
  assert.equal(TP.tidyThaiPunctuation('“เขาบอก "ไม่รู้" แล้วเดินไป”'), '“เขาบอก "ไม่รู้" แล้วเดินไป”', 'เครื่องหมายซ้อนคนละแบบ = ไม่แตะ');
  assert.equal(TP.tidyThaiPunctuation('“ก ข “ค” จ'), '“ก ข “ค” จ', 'จำนวนคี่ = ไม่แตะ');
  assert.equal(TP.tidyThaiPunctuation('“ก”/“ข”'), '“ก”/“ข”');
  assert.equal(TP.tidyThaiPunctuation('“ก”-“ข”'), '“ก”-“ข”');
  assert.equal(TP.tidyThaiPunctuation('‘หนู...ไม่รู้ แล้วจบ'), '‘หนู...ไม่รู้ แล้วจบ', 'คำพูดเดี่ยวเปิดไม่ปิด = ไม่แตะ');
  assert.equal(TP.tidyThaiPunctuation('[“ก”]'), '[“ก”]');
  assert.equal(TP.tidyThaiPunctuation('‘Let’s go’'), '‘Let’s go’');
  assert.equal(TP.tidyThaiPunctuation('ราคา 2…5 ล้าน'), 'ราคา 2…5 ล้าน');
});

test('C1 ด่านโค้ด: ฉบับเกลาถูกต้อง = ผ่าน', () => {
  assert.deepEqual(TP.checkThreeParaEdit(BEFORE, REWRITE), { ok: true, reasons: [] });
  assert.deepEqual(TP.checkThreeParaEdit(FOUR, REWRITE4), { ok: true, reasons: [] }, 'ฉบับเกลาที่ข้อสอบกลุ่ม D ใช้ต้องผ่านด่านโค้ดจริง ไม่งั้นข้อสอบจะผ่านด้วยเหตุผิด');
});

test('C2 ด่านโค้ดตีตก: จำนวนย่อหน้า · ขึ้นบรรทัดในย่อหน้า · ว่าง', () => {
  assert.equal(TP.checkThreeParaEdit(BEFORE, '').ok, false);
  assert.match(TP.checkThreeParaEdit(BEFORE, [C1, C2].join('\n\n')).reasons.join(), /3 ย่อหน้า/);
  assert.match(TP.checkThreeParaEdit(BEFORE, [C1, C2, C3, 'เพิ่ม'].join('\n\n')).reasons.join(), /3 ย่อหน้า/);
  assert.match(TP.checkThreeParaEdit(BEFORE, BEFORE.replace('วันนี้ “น้องมะลิ', 'วันนี้\n“น้องมะลิ')).reasons.join(), /ขึ้นบรรทัด/);
});

test('C3 ตัวเลข: เปลี่ยนจำนวน/หน่วย/ลำดับ = ตีตก · เลขไทยเท่าเลขอารบิก · รูปแบบเลขที่อ่านออก', () => {
  assert.match(TP.checkThreeParaEdit(BEFORE, BEFORE.replace('300 บาท', '3,000 บาท')).reasons.join(), /ตัวเลขเปลี่ยน/);
  assert.match(TP.checkThreeParaEdit(BEFORE, BEFORE.replace('2 ครั้ง', 'หลายครั้ง')).reasons.join(), /ตัวเลขเปลี่ยน/);
  assert.equal(TP.checkThreeParaEdit(BEFORE, BEFORE.replace('300 บาท', '๓๐๐ บาท')).ok, true);
  assert.deepEqual(TP.numbersOf('1,500 คน 19.00 น. เงิน 1.3 ล้าน'), ['1500|คน', '19.00|น', '1.3|ล้าน']);
  assert.deepEqual(TP.numbersOf('“5 ปี” ราคา 2 ไร่ 1 งาน เมื่อปี 2569 และ ปี 2570.'), ['2|ไร่', '1|งาน', '2569|', '2570|'], 'ไม่นับในคำพูด · คำไวยากรณ์ถัดไป = ว่าง · จุดท้ายเลขตัดทิ้ง');
  for (const [a, b] of [['2 ไร่', '2 แปลง'], ['2 เท่า', '2 รอบ'], ['42 นาย', '42 ศพ'], ['3 ขวด', '3 กล่อง'], ['5 รายการ', '5 ราย']]) {
    assert.match(TP.checkThreeParaEdit(pad(`มี ${a} ในงาน`), pad(`มี ${b} ในงาน`), { minWords: 0, rawText: b }).reasons.join(), /ตัวเลขเปลี่ยน/, `${a}→${b}`);
  }
  assert.match(TP.checkThreeParaEdit(pad('อายุ 60 ปี และ 55 ปี'), pad('อายุ 55 ปี และ 60 ปี'), { minWords: 0 }).reasons.join(), /ลำดับตัวเลข/);
});

test('C4 คำพูด: ถูกแก้/หาย/เพิ่มใหม่/สลับลำดับ = ตีตก · ช่องว่างและแบบเครื่องหมายไม่นับ', () => {
  assert.match(TP.checkThreeParaEdit(BEFORE, BEFORE.replace('หนูอยากกลับมาดูแล', 'หนูตั้งใจกลับมาดูแล')).reasons.join(), /คำพูดเปลี่ยน/);
  assert.match(TP.checkThreeParaEdit(BEFORE, BEFORE.replace('“น้องมะลิ ใจดี”', 'น้องมะลิ ใจดี')).reasons.join(), /คำพูดเปลี่ยน/);
  assert.match(TP.checkThreeParaEdit(BEFORE, BEFORE.replace('วันนี้ความฝัน', '“วันนี้” ความฝัน')).reasons.join(), /คำพูดเปลี่ยน/);
  assert.equal(TP.checkThreeParaEdit(BEFORE, BEFORE.replace('“น้องมะลิ ใจดี”', '"น้องมะลิ ใจดี"')).ok, true);
  const misclosed = pad('เขาบอกว่า “ถ้าไม่โอเค ไม่แต่งก็ได้นะ“ แล้วเดินออกไป');
  assert.match(TP.checkThreeParaEdit(misclosed, misclosed.replace('ถ้าไม่โอเค ไม่แต่งก็ได้นะ', 'ถ้าโอเค ก็แต่งเลยนะ'), { minWords: 0 }).reasons.join(), /คำพูดเปลี่ยน/, 'คำพูดปิดผิดข้างก็ต้องเห็น');
  assert.equal(TP.checkThreeParaEdit(misclosed, misclosed.replace('นะ“', 'นะ”'), { minWords: 0 }).ok, true, 'ซ่อมคู่เครื่องหมายอย่างเดียว = ผ่าน');
  assert.match(TP.checkThreeParaEdit(pad('ลุงบอกว่า “ไม่ผิด” ส่วนป้าบอกว่า “ผิดเอง”'), pad('ลุงบอกว่า “ผิดเอง” ส่วนป้าบอกว่า “ไม่ผิด”'), { minWords: 0 }).reasons.join(), /ลำดับคำพูด/);
});

test('C5 ด่านโค้ดตีตก: คำอังกฤษ · ความยาวเปลี่ยนมากทั้งสองทาง · คำต่ำกว่าขั้นต่ำ · อีโมจิ/แฮชแท็กใหม่ · ตัวพิมพ์เล็กใหญ่ไม่นับ', () => {
  const base = `${BEFORE} ตำรวจ CIB ยืนยัน`;
  assert.match(TP.checkThreeParaEdit(base, base.replace('CIB', 'DSI')).reasons.join(), /คำอังกฤษ/);
  assert.ok(!TP.checkThreeParaEdit(base, base.replace('CIB', 'cib')).reasons.join().includes('คำอังกฤษ'));
  const shortened = [C1, C2.slice(0, 90), C3.slice(0, 40)].join('\n\n');
  assert.match(TP.checkThreeParaEdit(BEFORE, shortened).reasons.join(), /ความยาวเปลี่ยนมาก/);
  assert.match(TP.checkThreeParaEdit(BEFORE, `${REWRITE} ${C3}`).reasons.join(), /ความยาวเปลี่ยนมาก/);
  assert.match(TP.checkThreeParaEdit(BEFORE, `${REWRITE} 😀`).reasons.join(), /อีโมจิ/);
  assert.match(TP.checkThreeParaEdit(BEFORE, `${REWRITE} #ข่าว`).reasons.join(), /แฮชแท็ก/);
  const fewerWords = BEFORE.replace(' ทั้งที่หลายคนบอกให้ออกมาทำงานช่วยที่บ้านตั้งแต่ยังเรียนไม่จบ', '');
  assert.match(TP.checkThreeParaEdit(BEFORE, fewerWords, { minWords: 100000 }).reasons.join(), /คำลดต่ำกว่าขั้นต่ำ/, 'ความยาวไม่เกินด่าน แต่คำลดต่ำกว่าฉบับเดิม');
});

test('C6 ตารางเคสความหมายของผู้ตรวจอิสระรอบ 1: ด่านโค้ดต้องตีตกโดยไม่พึ่งตัวตรวจ AI', () => {
  const cases = [
    ['ไม่ได้ตั้งใจ→ตั้งใจ', 'เธอยอมรับว่าไม่ได้ตั้งใจทำแก้วแตก', 'เธอยอมรับว่าตั้งใจทำแก้วแตก'],
    ['ไม่พบ→พบ', 'ตำรวจยืนยันว่าไม่พบสารเสพติดในตัวผู้ต้องหา', 'ตำรวจยืนยันว่าพบสารเสพติดในตัวผู้ต้องหา'],
    ['พบ→ไม่พบ', 'ตำรวจบอกว่าพบสารเสพติด', 'ตำรวจบอกว่าไม่พบสารเสพติด'],
    ['ยืนยัน→ปฏิเสธ', 'ผู้จัดการยืนยันข่าวการเลิกรา', 'ผู้จัดการปฏิเสธข่าวการเลิกรา'],
    ['หกแสน→หกล้าน', 'ถูกโกงเงินหกแสนบาท', 'ถูกโกงเงินหกล้านบาท'],
    ['หลักแสน→หลักล้าน', 'เสียหายหลักแสนบาท', 'เสียหายหลักล้านบาท'],
    ['หกแสน→เจ็ดแสน', 'ถูกโกงเงินหกแสนบาท', 'ถูกโกงเงินเจ็ดแสนบาท'],
    ['6 แสน→6 ล้าน', 'เสียหาย 6 แสนบาท', 'เสียหาย 6 ล้านบาท'],
    ['5 พันล้าน→5 พัน', 'เสียหาย 5 พันล้านบาท', 'เสียหาย 5 พันบาท'],
    ['10 กว่าล้าน→10 กว่าแสน', 'โดนโกงไป 10 กว่าล้านบาท', 'โดนโกงไป 10 กว่าแสนบาท'],
    ['กว่า→เกือบ', 'มีผู้เสียหายกว่า 300 คน', 'มีผู้เสียหายเกือบ 300 คน'],
    ['5 ปี→5 เดือน', 'รอคอยมานาน 5 ปี', 'รอคอยมานาน 5 เดือน'],
    ['50 กม.→50 ม.', 'วิ่งไกล 50 กิโลเมตร', 'วิ่งไกล 50 เมตร'],
    ['9 ต.ค.→9 พ.ย.', 'เกิดเหตุเมื่อ 9 ต.ค. ที่ผ่านมา', 'เกิดเหตุเมื่อ 9 พ.ย. ที่ผ่านมา'],
    ['9 ตุลาคม→9 พฤศจิกายน', 'เกิดเหตุเมื่อ 9 ตุลาคม', 'เกิดเหตุเมื่อ 9 พฤศจิกายน'],
    ['พ่อ→แม่', 'พ่อเป็นคนขับรถชนเด็ก', 'แม่เป็นคนขับรถชนเด็ก'],
    ['สลับอายุ', 'ลุงแดงอายุ 60 ปี ป้าขาวอายุ 55 ปี', 'ลุงแดงอายุ 55 ปี ป้าขาวอายุ 60 ปี'],
    ['สลับคำพูด', 'ลุงแดงบอกว่า "ผมไม่ผิด" ส่วนป้าขาวบอกว่า "ผมผิดเอง"', 'ลุงแดงบอกว่า "ผมผิดเอง" ส่วนป้าขาวบอกว่า "ผมไม่ผิด"'],
    ['อ้างว่า→ข้อเท็จจริง', 'ผู้เสียหายอ้างว่านายเอกโกงเงินไป', 'นายเอกโกงเงินไป'],
    ['เล่าว่า→ตัดที่มา', 'เพื่อนบ้านเล่าว่าเขาทำร้ายลูก', 'เขาทำร้ายลูก'],
    ['อาจ→แน่นอน', 'เขาอาจไม่ดีพอ', 'เขาไม่ดีพอ'],
    ['เปลี่ยนจังหวัด', 'เกิดเหตุที่จังหวัดเชียงใหม่', 'เกิดเหตุที่จังหวัดเชียงราย'],
    ['เติมเหตุการณ์', 'เจ้าตัวกลับบ้าน', 'เจ้าตัวร้องไห้กลับบ้าน'],
    ['เดาเพศ หนุ่ม', 'คุณต้าเดินเข้ามาในงาน', 'หนุ่มต้าเดินเข้ามาในงาน'],
    ['เดาเพศ เธอ', 'คุณต้าเดินเข้ามาในงาน', 'เธอเดินเข้ามาในงาน'],
    ['เติมสาว', 'คุณต้าเดินเข้ามาในงาน', 'สาวต้าเดินเข้ามาในงาน'],
    ['เติม และ แยกคน', 'พี่สาว น้องแก้วมาร่วมงาน', 'พี่สาว และน้องแก้วมาร่วมงาน'],
    ['เติม จึง', 'เขาตกงาน ภรรยาขอหย่า', 'เขาตกงาน ภรรยาจึงขอหย่า'],
    ['เติม เพราะ', 'เขาตกงาน ภรรยาขอหย่า', 'เขาตกงาน เพราะภรรยาขอหย่า'],
  ];
  for (const [name, a, b] of cases) assert.equal(TP.checkThreeParaEdit(pad(a), pad(b), { minWords: 0 }).ok, false, name);
  const longLost = pad(`${C2} ลุงสมชายเดินทางไปเยี่ยมหลานชายที่โรงพยาบาลจังหวัดขอนแก่นตั้งแต่เช้าตรู่`);
  assert.match(TP.checkThreeParaEdit(longLost, pad(C2), { minWords: 0 }).reasons.join(), /คำเนื้อหาหาย/, 'ตัดทั้งประโยค');
  const fewLost = pad(`${C2} วันเสาร์อากาศดี`);
  assert.ok(!TP.checkThreeParaEdit(fewLost, pad(C2), { minWords: 0 }).reasons.join().includes('คำเนื้อหาหาย'), 'หายไม่กี่คำจากการเกลา ไม่ถึงเพดาน');
});

test('C7 คำไวยากรณ์ที่ บก.เติมได้ = ผ่าน · คำใหม่ที่มีในข่าวดิบ = ผ่าน · คำที่มี "กว่า" ในตัวไม่นับ', () => {
  assert.equal(TP.checkThreeParaEdit(pad('เขาขยันรับงาน จนปลดหนี้ได้'), pad('แต่เขาก็ขยันรับงาน จนปลดหนี้ได้'), { minWords: 0 }).ok, true);
  assert.equal(TP.checkThreeParaEdit(pad('ประกาศในโหนกระแส'), pad('ประกาศในรายการโหนกระแส'), { minWords: 0, rawText: 'รายการโหนกระแส' }).ok, true);
  assert.equal(TP.checkThreeParaEdit(pad('ประกาศในโหนกระแส'), pad('ประกาศในรายการโหนกระแส'), { minWords: 0 }).ok, false);
  assert.equal(TP.checkThreeParaEdit(pad('ลุงยังมีลูกเล็ก'), pad('ลุงบอกว่ายังมีลูกเล็ก'), { minWords: 0 }).ok, true, 'บอกว่า ไม่ใช่คำว่า กว่า');
});

test('C7b คำที่มีในข่าวดิบก็ยังตีตก: ด่านคำสำคัญ/คำห้ามเพิ่ม/คำบอกเพศ/เลขคำไทย ต้องไม่พึ่งด่านคำใหม่', () => {
  const check = (a, b, rawText = b) => TP.checkThreeParaEdit(pad(a), pad(b), { minWords: 0, rawText }).reasons.join();
  assert.match(check('เสียหายหลักแสนบาท', 'เสียหายหลักล้านบาท'), /คำสำคัญเปลี่ยน: ล้าน/);
  assert.match(check('มีคนกว่าหมื่นคน', 'มีคนเกือบหมื่นคน'), /คำสำคัญเปลี่ยน: กว่า/);
  assert.match(check('เขาตกงาน ภรรยาขอหย่า', 'เขาตกงาน ภรรยาจึงขอหย่า'), /เพิ่มคำต้องห้าม: จึง/);
  assert.match(check('คุณต้าเดินเข้ามา', 'เธอเดินเข้ามา'), /เพิ่มคำต้องห้าม: เธอ/);
  assert.match(check('คุณต้าเดินเข้ามา', 'สาวต้าเดินเข้ามา'), /คำบอกเพศ: สาว/);
  assert.equal(check('มีลูกต้าอยู่', 'มีลูกสาวต้าอยู่').includes('คำบอกเพศ'), false, 'ลูกสาว ไม่ใช่การเดาเพศจากชื่อ');
  assert.match(check('ถูกโกงเงินหกแสนบาท', 'ถูกโกงเงินเจ็ดแสนบาท'), /เลขคำไทยเปลี่ยน/);
});

test('C7c ตรึงรายการคำทีละตัว (ผู้ตรวจรอบ 2: เอาคำออกจากรายการแล้วข้อสอบยังเขียว) · โพสต์ยาว คำใหม่มีในข่าวดิบ', () => {
  const body = 'ลุงสมชายเดินทางมาถึงงานเลี้ยงที่บ้านในตอนเย็นของวันเสาร์แล้วทักทายทุกคนอย่างเป็นกันเอง';
  const LONG = (x) => pad(`${body} ${x} ปิดท้าย`);
  const LONG0 = pad(`${body} ปิดท้าย`);
  const reasons = (a, b, rawText = 'ข่าวดิบ') => TP.checkThreeParaEdit(a, b, { minWords: 0, rawText }).reasons.join();
  for (const w of ['ไม่', 'ห้าม', 'ไร้', 'ปฏิเสธ', 'ยืนยัน', 'กล่าวหา', 'อ้าง', 'อย่างน้อย', 'อย่า', 'ล้าน', 'แสน', 'หมื่น', 'พัน', 'ร้อย', 'กว่า', 'เกือบ', 'ราว', 'ประมาณ', 'อดีต', 'ถูก', 'เคย', 'กำลัง', 'เตรียม', 'กล่าว', 'รายงาน', 'ลือ', 'ร้องเรียน', 'เหมือน', 'หรือ', 'ก่อน', 'หลัง', 'ขึ้น', 'ลง', 'เลย', 'จน', 'จะ', 'ให้', 'จาก', 'ได้', 'แค่', 'สรุป', 'ตาม']) {
    assert.match(reasons(LONG(w), LONG0), new RegExp(`คำสำคัญเปลี่ยน: ${w} `), `ตัด ${w}`);
    assert.match(reasons(LONG0, LONG(w), w), new RegExp(`คำสำคัญเปลี่ยน: ${w} `), `เพิ่ม ${w}`);
  }
  for (const w of ['ระบุ', 'เผย', 'แฉ', 'เล่า', 'บอก', 'แถลง', 'ซัด', 'อาจ', 'น่าจะ', 'คาดว่า', 'เชื่อว่า', 'สงสัย', 'พ่อ', 'แม่', 'สามี', 'ภรรยา', 'เมีย', 'ผัว', 'ปู่', 'ลุง', 'ป้า', 'หลาน', 'ลูก']) {
    const a = pad(`คนในงาน ${w} ${body.replace('ลุงสมชาย', 'นายเอก')} ปิดท้าย`);
    assert.match(reasons(a, a.replace(` ${w} `, ' ')), new RegExp(`คำสำคัญหาย: ${w} `), `ตัด ${w}`);
  }
  for (const w of ['เพราะ', 'จึง', 'เนื่องจาก', 'ทำให้', 'ส่งผลให้', 'เธอ', 'หนุ่ม', 'นาย', 'นาง', 'ผู้ชาย', 'ผู้หญิง']) {
    assert.match(reasons(LONG0, LONG(w), w), new RegExp(`เพิ่มคำต้องห้าม: ${w} `), `เพิ่ม ${w}`);
  }
  for (const w of ['หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ', 'ยี่สิบ']) {
    assert.match(reasons(LONG0, LONG(w), w), /เลขคำไทยเปลี่ยน/, `เลขคำ ${w}`);
  }
});

test('C7d เคสจากข่าวจริงรอบ 2: ผู้ตรวจรอบ 2 · เติม และ ติดคำ · คำบอกเวลากลับด้าน · คำตัดผิดไม่ตีตก', () => {
  const check = (a, b, rawText = b) => TP.checkThreeParaEdit(pad(a), pad(b), { minWords: 0, rawText }).reasons.join();
  assert.match(check('พี่สาว น้องแก้วมาร่วมงาน', 'พี่สาวและน้องแก้วมาร่วมงาน'), /หลังคำเรียกคน/);
  assert.match(check('อดีตสามีมาร่วมงาน', 'สามีมาร่วมงาน'), /คำสำคัญเปลี่ยน: อดีต/);
  assert.match(check('ก่อนตำรวจมาถึง', 'หลังตำรวจมาถึง'), /คำสำคัญเปลี่ยน/);
  assert.match(check('นายเอกจะฟ้องบริษัท', 'นายเอกฟ้องบริษัท'), /คำสำคัญเปลี่ยน: จะ/);
  assert.match(check('เขาตกงาน ภรรยาขอหย่า', 'เขาตกงาน ภรรยาก็เลยขอหย่า'), /คำสำคัญเปลี่ยน: เลย/);
  assert.equal(TP.checkThreeParaEdit(pad('คนหาซื้อคือก๊อต เงินผ่านบัญชีของก๊อต'), pad('คนหาซื้อคือก๊อต เงินผ่านบัญชีโดยก๊อต'), { minWords: 0 }).reasons.join().includes('คำใหม่'), false, 'โดยก๊อต ถูกตัดเป็น โด|ยก๊อต ต้องไม่นับเป็นคำใหม่');
  assert.match(check('เกิดเหตุที่เชียงใหม่', 'เกิดเหตุที่เชียงราย', 'ข่าวดิบ'), /คำใหม่/, 'คำใหม่จริงยังตีตก');
});

test('C8 ฉบับเกลาผ่านตัวกรองคำเสี่ยงและตัวจัดวรรคตอนก่อนส่ง', async () => {
  const base = BEFORE.replace('วันนี้ความฝันนั้นเป็นจริงแล้ว', 'วันนี้ความฝันนั้นเป็นจริงแล้ว เรื่องนี้โหดมาก');
  const r1 = await TP.runThreeParaEdit([version(base)], { rawText: 'เหตุรุนแรง', callModel: async () => reply(base), callChecker: passCheck });
  assert.equal(r1.applied, 1);
  assert.ok(!r1.versions[0].content.includes('โหด') && r1.versions[0].content.includes('รุนแรง'), 'คำเสี่ยงต้องถูกแทน');
  const r2 = await TP.runThreeParaEdit([version(BEFORE)], { callModel: async () => reply(REWRITE.replace('วันนี้ความฝัน', '..วันนี้ความฝัน')), callChecker: passCheck });
  assert.equal(r2.versions[0].content, REWRITE, 'ตัด .. ที่ AI ทิ้งไว้');
});

test('D1 ผ่านทุกด่าน = ถ้อยคำใหม่ · title/provenance เดิม · เก็บฉบับก่อนแก้ · ส่งข่าวดิบให้โมเดลและตัวตรวจ', async () => {
  let modelCall = null; let checkCall = null;
  const r = await TP.runThreeParaEdit([version(BEFORE)], {
    rawText: 'ข่าวดิบทดสอบ',
    callModel: async (a) => { modelCall = a; return reply(REWRITE); },
    callChecker: async (a) => { checkCall = a; return { issues: [{ text: 'เล็กน้อย', why: 'x', severity: 'เบา' }] }; },
  });
  const v = r.versions[0];
  assert.equal(v.content, REWRITE);
  assert.equal(v._preLayoutContent, BEFORE);
  assert.equal(v.title, 'หัวข่าวเดิม');
  assert.equal(v.usedModel, 'claude-fable-5-1');
  assert.equal(v._layoutEdit.rewritten, true);
  assert.equal(v._layoutEdit.mode, 'three_para');
  assert.equal(v._layoutEdit.lightIssues, 1);
  assert.deepEqual(v._layoutEdit.lightDetails, [{ text: 'เล็กน้อย', why: 'x' }], 'เก็บข้อความจุดเบาให้ตรวจย้อนได้');
  assert.equal(r.applied, 1);
  assert.equal(r.packed, 0);
  assert.match(modelCall.prompt, /ข่าวดิบทดสอบ/);
  assert.equal(modelCall.system, TP.SYS_THREE_PARA);
  assert.equal(modelCall.feature, 'threeParaEdit');
  assert.equal(checkCall.feature, 'threeParaCheck');
  assert.equal(checkCall.effort, 'medium');
  assert.equal(checkCall.system, TP.SYS_THREE_PARA_CHECK);
  assert.ok(checkCall.user.includes(BEFORE) && checkCall.user.includes(REWRITE) && checkCall.user.includes('ข่าวดิบทดสอบ'));
});

test('D2 ด่านโค้ดไม่ผ่าน = ไม่เรียกตัวตรวจ · ถ้อยคำเดิมจัดด้วยโค้ด', async () => {
  let checked = 0;
  const r = await TP.runThreeParaEdit([version(FOUR)], { callModel: async () => reply(FOUR.replace('300 บาท', '999 บาท')), callChecker: async () => { checked++; return { issues: [] }; } });
  assert.equal(checked, 0);
  assert.equal(r.versions[0].content, PACKED);
  assert.equal(r.versions[0]._preLayoutContent, FOUR);
  assert.equal(r.versions[0]._layoutEdit.rewritten, false);
  assert.match(r.versions[0]._layoutEdit.reasons.join(), /ตัวเลขเปลี่ยน/);
  assert.equal(r.applied, 0);
  assert.equal(r.packed, 1);
  assert.match(r.summaryLine, /ไม่ผ่านด่าน 1/);
});

test('D3 ตัวตรวจเจอจุดหนัก/ป้ายแปลก/ผลไม่ครบ/ผลรูปแบบแปลก/ล้ม = ไม่ใช้ถ้อยคำที่ AI แก้ (ปิดจุด fail-open ของผู้ตรวจรอบ 1)', async () => {
  const cases = [
    async () => ({ issues: [{ text: 'สลับคน', why: 'x', severity: 'หนัก' }] }),
    async () => ({ issues: [{ text: 'ป้ายแปลก', why: 'x', severity: 'ปานกลาง' }] }),
    async () => ({ issues: [{ text: 'เบาปนหนัก', severity: 'เบา' }, { text: 'หนัก', severity: 'หนัก' }] }),
    async () => ({ issues: [{ description: 'ยืนยันกลายเป็นปฏิเสธ' }] }),
    async () => ({ issues: [{ issue: 'ผิด', reason: 'x' }, { problem: 'ผิด' }] }),
    async () => ({ issues: 'ไม่ใช่รายการ' }),
    async () => ({}),
    async () => null,
    async () => { throw new Error('checker down'); },
  ];
  for (const callChecker of cases) {
    const r = await TP.runThreeParaEdit([version(FOUR)], { callModel: async () => reply(REWRITE4), callChecker });
    assert.equal(r.versions[0].content, PACKED);
    assert.equal(r.applied, 0);
  }
});

test('D4 โมเดลล้ม/ไม่มีแท็ก post/ไม่มีเนื้อ = ถ้อยคำเดิมจัดด้วยโค้ด · ล้มมีคำเตือน', async () => {
  const fail = await TP.runThreeParaEdit([version(FOUR)], { callModel: async () => { throw new Error('boom'); }, callChecker: passCheck });
  assert.equal(fail.versions[0].content, PACKED);
  assert.match(fail.warning, /boom/);
  const noTag = await TP.runThreeParaEdit([version(FOUR)], { callModel: async () => 'ตอบไม่มีแท็ก', callChecker: passCheck });
  assert.equal(noTag.versions[0].content, PACKED);
  assert.match(noTag.versions[0]._layoutEdit.reasons.join(), /แท็ก post/);
  const dots = await TP.runThreeParaEdit([version(BEFORE.replace('วันนี้ความฝัน', '..วันนี้ความฝัน'))], { callModel: async () => { throw new Error('boom'); }, callChecker: passCheck });
  assert.equal(dots.versions[0].content, BEFORE, 'ถ้อยคำเดิมก็ต้องผ่านตัวจัดวรรคตอน');
  let called = 0;
  const empty = await TP.runThreeParaEdit([version('')], { callModel: async () => { called++; return reply(REWRITE); }, callChecker: passCheck });
  assert.equal(called, 0, 'ไม่มีเนื้อ = ห้ามให้ AI แต่งเอง');
  assert.equal(empty.versions[0].content, '');
});

test('D5 ตรวจซ้ำของท่อตีตกฉบับเกลา = ถ้อยคำเดิมจัดด้วยโค้ด · ตีตกทั้งสองชั้น/โยน error = ฉบับเดิมทุกไบต์ และเก็บเหตุไว้', async () => {
  const first = await TP.runThreeParaEdit([version(FOUR)], { callModel: async () => reply(REWRITE4), callChecker: passCheck, recheck: (v, text) => (text === REWRITE4 ? ['ผล grounding เปลี่ยน'] : []) });
  assert.equal(first.versions[0].content, PACKED);
  assert.match(first.versions[0]._layoutEdit.reasons.join(), /grounding/);
  const both = await TP.runThreeParaEdit([version(FOUR)], { callModel: async () => reply(REWRITE4), callChecker: passCheck, recheck: () => ['แย่ลง'] });
  assert.equal(both.versions[0].content, FOUR);
  assert.equal(both.versions[0]._preLayoutContent, undefined);
  assert.equal(both.versions[0]._layoutEdit.applied, false);
  assert.equal(both.versions[0]._layoutEdit.reasons.length, 2, 'เก็บเหตุทั้งสองชั้น');
  assert.equal(both.applied, 0);
  assert.equal(both.packed, 0);
  const thrown = await TP.runThreeParaEdit([version(FOUR)], { callModel: async () => reply(REWRITE4), callChecker: passCheck, recheck: () => { throw new Error('พัง'); } });
  assert.equal(thrown.versions[0].content, FOUR);
});

test('D6 หลายฉบับแยกกัน: ฉบับหนึ่งล้มไม่กระทบอีกฉบับ · ไม่มีฉบับ = ข้าม', async () => {
  const r = await TP.runThreeParaEdit([version(BEFORE), version(FOUR)], { callModel: async ({ prompt }) => { if (prompt.includes('ย่อหน้ากลางเพิ่มเติม')) throw new Error('ล้มเฉพาะฉบับ'); return reply(REWRITE); }, callChecker: passCheck });
  assert.equal(r.versions[0].content, REWRITE);
  assert.equal(r.versions[1].content, PACKED);
  assert.equal(r.applied, 1);
  assert.equal(r.packed, 1);
  const empty = await TP.runThreeParaEdit([], {});
  assert.equal(empty.skipped, true);
  assert.deepEqual(empty.versions, []);
});

const blockRunner = () => {
  const src = readFileSync(`${ROOT}src/lib/services/autoFlowServiceText.js`, 'utf8');
  const start = src.indexOf('  // ★ 28 ต.ค. 69 (เจ้าของสั่ง "เปิดใช้จริงในระบบ")');
  const end = src.indexOf('  ({ classic: classicVersionCount', start);
  assert.ok(start > 0 && end > start, 'ต้องหาท่อนขั้น บก.จัดหน้า ในซอร์สจริงได้');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction('ctx', `
    let { finalVersions } = ctx;
    const { detectedType, rawText, groundingSourceText, pipelineQualityWarnings, addLog, _autoWorkflowId, logPipeline, isLayoutEditEnabled, runLayoutEdit, isThreeParaEditEnabled, runThreeParaEdit,
      assessRawTextSafety, annotateMissingRawFacts, neutralizeGuessedGender } = ctx;
    ${src.slice(start, end)}
    return { finalVersions };
  `);
};

test('D7 ท่อนจริงใน autoFlowServiceText (ด่านจำลอง): เปิดสวิตช์ = เรียก บก.สามย่อหน้าแทน · log ตรงความจริง · ปิดสวิตช์ = เรียกตัวเดิม · LAYOUT_EDIT ปิด = ไม่เรียกทั้งคู่', async () => {
  const run = blockRunner();
  const scenario = async ({ layout = true, three = true, recheckWorse = false, model = async () => reply(REWRITE4) }) => {
    const calls = { three: 0, layout: 0 }; const piped = [];
    const out = await run({
      finalVersions: [version(FOUR)], detectedType: 'text', rawText: 'ดิบ', groundingSourceText: 'ดิบ', pipelineQualityWarnings: [], addLog: () => {}, _autoWorkflowId: 'wf_tp',
      logPipeline: async (x) => { piped.push(x); }, isLayoutEditEnabled: () => layout, isThreeParaEditEnabled: () => three,
      runThreeParaEdit: (vs, opts) => { calls.three++; return TP.runThreeParaEdit(vs, { ...opts, callModel: model, callChecker: passCheck }); },
      runLayoutEdit: async (vs) => { calls.layout++; return { versions: vs, applied: 0, warning: null, summaryLine: 'เดิม' }; },
      assessRawTextSafety: (vs) => ({ issues: recheckWorse && vs[0].content === REWRITE4 ? ['V1: x'] : [] }),
      annotateMissingRawFacts: () => ({ flagged: [] }), neutralizeGuessedGender: () => ({ warned: [] }),
    });
    return { calls, piped, content: out.finalVersions[0].content };
  };
  const on = await scenario({});
  assert.deepEqual(on.calls, { three: 1, layout: 0 });
  assert.equal(on.content, REWRITE4);
  assert.equal(on.piped[0].step, 'layout-edit');
  assert.equal(on.piped[0].status, 'success');
  const worse = await scenario({ recheckWorse: true });
  assert.equal(worse.content, PACKED, 'ด่านของท่อตีตกฉบับเกลา = ถ้อยคำเดิมจัดด้วยโค้ด');
  assert.equal(worse.piped[0].status, 'fallback', 'AI ไม่ผ่าน ต้องไม่ log success');
  const down = await scenario({ model: async () => { throw new Error('เครดิตหมด'); } });
  assert.equal(down.content, PACKED);
  assert.equal(down.piped[0].status, 'fallback', 'AI ล้ม ต้องไม่ log success');
  const off = await scenario({ three: false });
  assert.deepEqual(off.calls, { three: 0, layout: 1 });
  assert.equal(off.content, FOUR);
  const none = await scenario({ layout: false });
  assert.deepEqual(none.calls, { three: 0, layout: 0 });
  assert.equal(none.content, FOUR);
});

test('D8 ท่อนจริง + ด่านจริง: เกลาแล้วข้อความสุขภาพหลุดจากที่มา (ด่านโค้ดของขั้นปล่อย) → ด่าน grounding ตีกลับเป็นฉบับเดิม', async () => {
  const run = blockRunner();
  const RAW = 'ลุงสมชายอายุ 62 ปี แพทย์แนะนำว่าการกินสมุนไพรนี้ช่วยลดอาการได้';
  const health = pad('ลุงสมชายอายุ 62 ปี แพทย์แนะนำว่าการกินสมุนไพรนี้ช่วยลดอาการได้');
  const moved = 'ลุงสมชายอายุ 62 ปี แพทย์แนะนำว่า\n\nการกินสมุนไพรนี้ช่วยลดอาการได้ ย่อหน้าสองเหมือนเดิม\n\nย่อหน้าสามเหมือนเดิม';
  assert.equal(TP.checkThreeParaEdit(health, moved, { minWords: 0, rawText: RAW }).ok, true, 'ด่านในตัวปล่อยเคสนี้ (ต้องพึ่งตรวจซ้ำ)');
  const out = await run({
    finalVersions: [version(health)], detectedType: 'text', rawText: RAW, groundingSourceText: RAW, pipelineQualityWarnings: [], addLog: () => {}, _autoWorkflowId: 'wf_tp2', logPipeline: async () => {},
    isLayoutEditEnabled: () => true, isThreeParaEditEnabled: () => true, runLayoutEdit: async () => { throw new Error('ห้ามเรียก'); },
    runThreeParaEdit: (vs, opts) => TP.runThreeParaEdit(vs, { ...opts, callModel: async () => reply(moved), callChecker: passCheck }),
    assessRawTextSafety: AF.assessRawTextSafety, annotateMissingRawFacts, neutralizeGuessedGender,
  });
  assert.equal(out.finalVersions[0].content, health);
  assert.match(out.finalVersions[0]._layoutEdit.reasons.join(), /grounding/);
});

test('D9 AI ตอบถ้อยคำเดิม/เปลี่ยนแค่แบบเครื่องหมายคำพูด = ไม่นับว่าเกลา (log ต้องไม่ขึ้น success เพราะเรื่องนี้)', async () => {
  const same = await TP.runThreeParaEdit([version(BEFORE)], { callModel: async () => reply(BEFORE), callChecker: passCheck });
  assert.equal(same.applied, 0);
  assert.equal(same.packed, 0);
  assert.equal(same.versions[0]._layoutEdit.rewritten, false);
  const straight = BEFORE.replace('“น้องมะลิ ใจดี”', '"น้องมะลิ ใจดี"');
  const quoteOnly = await TP.runThreeParaEdit([version(straight)], { callModel: async () => reply(BEFORE), callChecker: passCheck });
  assert.equal(quoteOnly.applied, 0);
  assert.equal(quoteOnly.packed, 1);
  assert.equal(quoteOnly.versions[0].content, BEFORE);
  assert.equal(quoteOnly.versions[0]._layoutEdit.rewritten, false);
});

test('D10 สวิตช์ AI ปิดค่าเริ่มต้น เปิดเฉพาะ THREE_PARA_AI=1 · ปิด = ไม่เรียกโมเดล รวมย่อหน้า + จัดวรรคตอนด้วยโค้ด ถ้อยคำเดิมทุกคำ · log = success/skipped ตามจริง', async () => {
  await withEnv({ THREE_PARA_AI: '1' }, () => assert.equal(TP.isThreeParaAiEnabled(), true));
  await withEnv({ THREE_PARA_AI: ' "1" ' }, () => assert.equal(TP.isThreeParaAiEnabled(), true));
  for (const off of [undefined, '', '0', 'off', 'O', 'true', 'ปิด', ' "0" ']) await withEnv({ THREE_PARA_AI: off }, () => assert.equal(TP.isThreeParaAiEnabled(), false, String(off)));
  await withEnv({ THREE_PARA_AI: undefined }, async () => {
    let called = 0;
    const model = async () => { called++; return reply(REWRITE4); };
    const r = await TP.runThreeParaEdit([version(FOUR.replace('วันนี้ความฝัน', '..วันนี้ความฝัน'))], { callModel: model, callChecker: passCheck });
    assert.equal(called, 0);
    assert.equal(r.skipped, undefined, 'จัดจริงต้องไม่ log skipped');
    assert.equal(r.applied, 1);
    assert.equal(r.packed, 1);
    assert.equal(r.versions[0].content, PACKED);
    assert.equal(r.versions[0]._layoutEdit.rewritten, false);
    assert.match(r.summaryLine, /ปิด AI/);
    const nothing = await TP.runThreeParaEdit([version(BEFORE)], { callModel: model, callChecker: passCheck });
    assert.equal(called, 0);
    assert.equal(nothing.skipped, true, 'ไม่มีอะไรต้องจัด');
    assert.equal(nothing.versions[0].content, BEFORE);
  });
});

test('E1 เวลางานเหลือน้อย = ไม่เรียกโมเดล แต่ยังจัดย่อหน้าด้วยโค้ด · log = skipped', async () => {
  let called = 0;
  const deadline = createPipelineDeadline({ deadlineAt: Date.now() + 40_000 });
  const r = await runWithPipelineDeadline(deadline, () => TP.runThreeParaEdit([version(FOUR)], { callModel: async () => { called++; return reply(REWRITE); }, callChecker: passCheck }));
  assert.equal(called, 0);
  assert.equal(r.skipped, true);
  assert.equal(r.versions[0].content, PACKED);
  assert.equal(r.applied, 0);
  assert.equal(r.packed, 1);
});

test('E2 ส่ง signal ถึงทั้งโมเดลและตัวตรวจ · หมดเวลาทั้งขั้นตัดงานจริง = ฉบับที่ยังไม่เสร็จใช้ถ้อยคำเดิมจัดด้วยโค้ด + คำเตือน · ฉบับที่เสร็จแล้วยังใช้', async () => {
  const deadline = createPipelineDeadline({ deadlineAt: Date.now() + 600_000 });
  const seen = { model: [], checker: [] }; let aborted = 0;
  const r = await runWithPipelineDeadline(deadline, () => TP.runThreeParaEdit([version(BEFORE), version(FOUR)], {
    timeoutMs: 80,
    minStageMs: 10,
    callModel: ({ prompt, signal }) => {
      seen.model.push(signal);
      if (!prompt.includes('ย่อหน้ากลางเพิ่มเติม')) return Promise.resolve(reply(REWRITE));
      return new Promise((_, reject) => { signal.addEventListener('abort', () => { aborted++; reject(new Error('ยกเลิก')); }, { once: true }); });
    },
    callChecker: async ({ signal }) => { seen.checker.push(signal); return { issues: [] }; },
  }));
  assert.ok(seen.model.every((s) => s instanceof AbortSignal) && seen.model.length === 2, 'โมเดลต้องได้ signal');
  assert.ok(seen.checker[0] instanceof AbortSignal, 'ตัวตรวจต้องได้ signal');
  assert.equal(aborted, 1, 'ต้องตัดสายจริง');
  assert.equal(r.versions[0].content, REWRITE);
  assert.equal(r.versions[1].content, PACKED);
  assert.ok(r.warning);
});
