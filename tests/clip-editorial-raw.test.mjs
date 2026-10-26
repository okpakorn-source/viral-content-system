/**
 * ตัวช่วยคัดลอกเนื้อพร้อมใช้ (clipNewsReadyText) + สัญญาปุ่มคัดลอกเว็บ/มือถือ
 * ★ 26 ต.ค. 69 (ระบบถอดคลิปเฟส 4): เครื่องยนต์เดิมและกฎพรอมต์ directLead ถูกลบ — เทสของส่วนนั้นลบตาม
 *   ที่เหลือคือสิ่งที่ยังใช้งาน: /m ใช้ clipNewsReadyText คัดลอกใบเก่า · เว็บใช้การ์ดเนื้อข่าวช่องเดียว
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE_SOURCE = readFileSync(new URL('../src/app/clip-transcript/page.js', import.meta.url), 'utf8');
const MOBILE_SOURCE = readFileSync(new URL('../src/app/m/page.js', import.meta.url), 'utf8');
const CARD_SOURCE = readFileSync(new URL('../src/app/clip-transcript/ui/InsightCard.js', import.meta.url), 'utf8');
const JOBBOARD_SOURCE = readFileSync(new URL('../src/app/clip-transcript/ui/JobBoard.js', import.meta.url), 'utf8');
const WEB_SOURCE = PAGE_SOURCE + '\n' + CARD_SOURCE + '\n' + JOBBOARD_SOURCE;

test('single-topic export ไม่ต่อ headline/overview/keyPoints ซ้ำ และไม่ทำคำพูดตรงซ้ำ', async () => {
  const { buildClipNewsReadyText } = await import('../src/lib/services/clipNewsReadyText.js');
  const raw = 'นักเรียนเก็บเงินซื้อชุดปฐมพยาบาล\n\nเจ้าของร้านพูดว่า คำพูดที่อยู่ในเนื้อแล้ว และมอบให้โดยไม่คิดเงิน';
  const out = buildClipNewsReadyText({
    headline: 'หัวข้อที่ไม่ควรถูกต่อซ้ำ',
    overview: 'ภาพรวมที่ไม่ควรถูกต่อซ้ำ',
    keyPoints: [{ point: 'ประเด็นซ้ำ' }],
    quotes: ['คำพูดที่อยู่ในเนื้อแล้ว', 'คำพูดตรงที่มีเฉพาะช่องหลักฐาน'],
    rawData: `  ${raw}  `,
    subStories: [],
  });
  assert.equal(out, `${raw}\n\nคำพูดสำคัญจากคลิป:\n“คำพูดตรงที่มีเฉพาะช่องหลักฐาน”`);
  assert.doesNotMatch(out, /หัวข้อที่ไม่ควรถูกต่อซ้ำ|ประเด็นซ้ำ|คำพูดซ้ำ/);
  assert.equal((out.match(/คำพูดที่อยู่ในเนื้อแล้ว/g) || []).length, 1);
});

test('multi-topic export ใช้เฉพาะก้อนประเด็นที่ครบในตัวเอง ไม่ต่อ rawData หรือ quote รวมข้ามเรื่อง', async () => {
  const { buildClipNewsReadyText } = await import('../src/lib/services/clipNewsReadyText.js');
  const out = buildClipNewsReadyText({
    rawData: 'ก้อนรวมที่ห้ามถูกต่อซ้ำ',
    keyPoints: [{ point: 'ภาพรวมซ้ำ' }],
    quotes: ['ซ้ำในเนื้อแล้ว', 'คำพูดรวมที่มีเฉพาะช่องหลักฐาน'],
    subStories: [
      { no: 1, topic: 'เรื่องครอบครัว', timeRange: '0:10–2:00', rawData: 'เจ้าตัวพูดว่า ซ้ำในเนื้อแล้ว', quotes: ['ซ้ำในเนื้อแล้ว', 'คำพูดตรงที่ยังไม่มีในเนื้อ'] },
      { no: 2, topic: 'เรื่องธุรกิจ', timeRange: '2:01–4:00', rawData: 'เนื้อธุรกิจครบในตัวเอง', keyPoints: ['ซ้ำในเนื้อแล้ว'] },
    ],
  });
  assert.equal(out, [
    'ประเด็น 1: เรื่องครอบครัว (0:10–2:00)',
    '',
    'เจ้าตัวพูดว่า ซ้ำในเนื้อแล้ว',
    '',
    'คำพูดสำคัญจากคลิป:',
    '“คำพูดตรงที่ยังไม่มีในเนื้อ”',
    '',
    'ประเด็น 2: เรื่องธุรกิจ (2:01–4:00)',
    '',
    'เนื้อธุรกิจครบในตัวเอง',
  ].join('\n'));
  assert.doesNotMatch(out, /ก้อนรวมที่ห้ามถูกต่อซ้ำ|ภาพรวมซ้ำ/);
  assert.doesNotMatch(out, /คำพูดรวมที่มีเฉพาะช่องหลักฐาน/, 'quote รวมที่ไม่รู้ว่าเป็นของเรื่องไหนห้ามไปต่อท้ายเรื่องสุดท้าย');
  assert.equal((out.match(/ซ้ำในเนื้อแล้ว/g) || []).length, 1);
});

test('subStories มีแค่ก้อนเดียวให้ใช้ rawData รวมตามสัญญา single-story', async () => {
  const { buildClipNewsReadyText } = await import('../src/lib/services/clipNewsReadyText.js');
  assert.equal(buildClipNewsReadyText({
    rawData: 'เนื้อรวมที่ครบกว่า',
    subStories: [{ topic: 'ก้อนที่โมเดลแยกเกินมา', rawData: 'เนื้อย่อย' }],
  }), 'เนื้อรวมที่ครบกว่า');
});

test('คำเตือนประโยคเปิดของใบเก่าแสดงบนมือถือ · การ์ดเว็บไม่มีกล่องประโยคเปิดแล้ว', () => {
  assert.doesNotMatch(CARD_SOURCE, /editorialWarnings|directLead/);
  // มือถือคงเดิม (ไม่ได้แตะ /m — เจ้าของแจ้ง 26 ต.ค. ว่าไม่ใช้แล้ว)
  assert.match(MOBILE_SOURCE, /insight\.editorialWarnings\?\.length > 0/);
  assert.match(MOBILE_SOURCE, /จุดให้พนักงานตรวจประโยคเปิด/);
});

test('ปุ่มคัดลอกเว็บส่งพาดหัว+เนื้อข่าวช่องเดียว · มือถือคงตัวช่วย projection เดิม', () => {
  // ★ 26 ต.ค. 69: เว็บมีปุ่มคัดลอกเดียว = พาดหัว + เนื้อข่าว (cardView.copyText) — เลิกก้อนรวม/ประเด็นย่อย
  assert.match(CARD_SOURCE, /คัดลอกพาดหัว\+เนื้อข่าว/);
  assert.doesNotMatch(CARD_SOURCE, /คัดลอกก้อนรวม|buildClipSubStoryText/);
  // ★ กันบั๊ก UI-01 (คัดลอกกลับด้าน): หน้า = copy(key, text) · การ์ดส่ง (คีย์ปุ่ม, ข้อความ) ตามลำดับเดียวกัน
  assert.match(PAGE_SOURCE, /const copy = \(key, text\)/);
  assert.match(CARD_SOURCE, /onCopy\(copyKey, view\.copyText\)/);
  // ข้อความความปลอดภัยตอนรอลองใหม่ (retry_wait) ยังอยู่ในเว็บ (JobBoard) — ต้องไม่สื่อว่าถอดซ้ำเสียเงิน
  assert.match(WEB_SOURCE, /ไม่วนถอดซ้ำอัตโนมัติ/);
  assert.match(WEB_SOURCE, /เซิร์ฟเวอร์ยืนยันว่าลองส่งใหม่ได้อย่างปลอดภัย/);
  assert.doesNotMatch(WEB_SOURCE, /ลองให้เองจน Gemini ว่าง|รันให้เองจน Gemini ว่าง|Gemini แน่น กำลังสู้อยู่/);

  assert.match(MOBILE_SOURCE, /import \{ buildClipNewsReadyText, buildClipSubStoryText \}/);
  assert.match(MOBILE_SOURCE, /const clipAllText = \(ins\) => buildClipNewsReadyText\(ins\)/);
  assert.match(MOBILE_SOURCE, /คัดลอกเนื้อพร้อมใช้/);
  assert.equal((MOBILE_SOURCE.match(/คัดลอกก้อนรวมเดิม/g) || []).length, 2);
  assert.ok((MOBILE_SOURCE.match(/buildClipSubStoryText\(/g) || []).length >= 4, 'คัดลอก/ส่งประเด็นบนมือถือทั้งหมดต้องใช้ helper เดียวกัน');
  assert.doesNotMatch(MOBILE_SOURCE, /if \(ins\.multiTopic && ins\.topics\?\.length\)/, 'ห้ามฟื้นตัวต่อข้อความแบบเก่าบนมือถือ');
});

// ★ 9 ก.ย. 69 เสียงคนเล่าในเนื้อดิบ (เจ้าของชี้เคสมิค-เบนซ์: "ระบุว่า/ตน/ดังกล่าว" โผล่ในก้อนรวม + ชื่อซ้ำ + ทุกย่อหน้าขึ้นต้นใหม่)
// ก้อนรวม (rawData) คือของที่เจ้าของใช้เขียนข่าวจริง — สัญญาเสียงคนเล่าต้องอยู่ในพรอมต์ต้นทางตัวนี้ ไม่ใช่แค่ขั้นเรียบเรียง v2