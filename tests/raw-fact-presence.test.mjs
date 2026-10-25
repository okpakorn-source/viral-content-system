// 🔏 ข้อสอบข้อ 3 (25 ต.ค. 69 · ผลทดสอบท่อทีละขั้น ข่าวพยาบาลร้อยเอ็ด): ข้อมูลต้นฉบับหาย
//   A. ด่านโค้ด rawFactPresence: ดึงวันที่/อายุ/จำนวนเงินจากข้อความดิบ → ฉบับที่ไม่เจอ = ป้าย _missingFacts (รูปที่บอทอ่าน)
//      รอบ 2 (ผู้ตรวจอิสระวัดคลังงานจริง 117 งาน): เคสเตือนผิด ขวบ/อายุไม่มีหน่วย/แสน-ล้าน/เลขวันที่ติดเลขอื่น ต้องไม่เตือน
//   B. ต่อเข้าท่อ: autoFlowServiceText เรียก annotateMissingRawFacts หลังด่านความยาว (พฤติกรรมจริงอยู่ที่ partial-angles-pl08 ข้อ H)
//   C. กฎใบสั่งเขียน "ระบุวันที่ = คงไว้ · ไม่ระบุ = ห้ามเติม" + สวิตช์ถอย WRITER_KEEP_FACTS_RULE ทนอัญประกาศ/off/false/no
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as RFP from '../src/lib/services/rawFactPresence.js';

const RAW = 'เหตุการณ์เกิดขึ้นเมื่อเวลาประมาณ 16.00 น. วันเสาร์ที่ 17 ตุลาคม 2569 บริเวณถนนริมคลอง โดยญาติกำลังพาคุณยายวัย 81 ปี กลับจากการฟอกไต';
const labels = (raw) => RFP.extractCheckableRawFacts(raw).map((f) => f.label);
const missing = (raw, content) => RFP.findMissingRawFacts([{ content }], raw).flatMap((x) => x.missing.map((m) => m.text));
const withEnv = async (vars, fn) => {
  const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('A1 ดึงข้อเท็จจริงจากข้อความดิบ: วันที่ + อายุ (ไม่เช็คเวลา)', () => {
  assert.deepEqual(labels(RAW), ['17 ตุลาคม', 'วัย 81 ปี']);
});

test('A2 ฉบับที่ตัดวันที่ทิ้ง = ติดป้าย · ฉบับครบ = ตัวเดิม · ตัวย่อเดือน/เลขไทยนับว่ามี', async () => {
  await withEnv({ RAW_FACT_PRESENCE_WARN: undefined }, () => {
    const v1 = { content: 'วันเสาร์ที่ 17 ต.ค. คุณยายวัย ๘๑ ปี หมดสติริมถนน' };
    const v2 = { content: 'คุณยายวัย 81 ปี หมดสติริมถนน พยาบาลจอดรถลงไปช่วย', _sourceLabel: 'มุม 2' };
    const { versions, flagged } = RFP.annotateMissingRawFacts([v1, v2], RAW);
    assert.equal(versions[0], v1, 'ฉบับครบต้องเป็นตัวเดิม');
    assert.deepEqual(versions[1]._missingFacts, { checked: true, missing: [{ type: 'date', text: '17 ตุลาคม' }], source: 'rawFactPresence' });
    assert.equal(versions[1]._sourceLabel, 'มุม 2');
    assert.equal(v2._missingFacts, undefined, 'ห้ามแก้ของเดิม');
    assert.deepEqual(flagged, [{ version: 2, missing: [{ type: 'date', text: '17 ตุลาคม' }] }]);
  });
});

test('A3 เคสเตือนผิดที่ผู้ตรวจเจอ ต้องไม่เตือน: ขวบ · อายุไม่มีหน่วย · แสน/ล้าน · เลขวันที่ติดเลขอื่น · ยอดวิว', () => {
  assert.deepEqual(missing('น้องแบงค์ วัย 10 ขวบ ขายของ', 'เด็กชายอายุ 10 ขวบ'), []);
  assert.deepEqual(missing('น้องวัย 10 ปี', 'น้องอายุ 10 ขวบ'), []);
  assert.deepEqual(missing('เข้าวงการวัย 15 ปี จนถึงวัย 28 ปี', 'ทำงานตั้งแต่อายุ 15 จนถึง 28 รวม 13 ปี'), []);
  assert.deepEqual(missing('ควักเงิน 600,000 บาท', 'เงินเกือบ 6 แสนบาท'), []);
  assert.deepEqual(missing('บริจาค 5 ล้านบาท', 'มอบเงิน 5,000,000 บาท'), []);
  assert.deepEqual(missing('บริจาค 2,500,000 บาท', 'ยอด 2.5 ล้าน ให้โรงพยาบาล'), []);
  assert.deepEqual(labels('บ้านเลขที่ 117 ตุลาคม'), [], '117 ไม่ใช่วันที่ 17');
  assert.deepEqual(labels('ยอดวิว 1 ล้านครั้ง ผู้ชม 3 แสนคน'), [], 'ยอดวิว/จำนวนคนไม่ใช่เงิน');
  // รอบ 2 วัดคลังงานจริง: ตัวเลขเขียนเป็นคำไทย
  assert.deepEqual(missing('เงินเดือนเริ่มต้น 10,000 บาท', 'เงินเดือนเริ่มต้นราวหมื่นบาท'), []);
  assert.deepEqual(missing('คุณตาวัย 71 ปี', 'คุณตาวัยเจ็ดสิบเอ็ดปี'), []);
  assert.deepEqual(missing('น้อง 8 ขวบ', 'เด็กแปดขวบ'), []);
  assert.deepEqual(missing('บริจาค 5 ล้านบาท', 'บริจาคห้าล้านบาท'), []);
});

test('A4 ยังจับของหายจริง: เลขต้องตรงทั้งตัว · เงินคนละค่า · ไม่มีเลขที่เช็คได้ = ไม่เตือน', () => {
  assert.deepEqual(missing(RAW, 'วันที่ 117 ตุลาคม คนวัย 181 ปี'), ['17 ตุลาคม', 'วัย 81 ปี']);
  assert.deepEqual(missing('บริจาค 12,500 บาท', 'ยอดบริจาค 12500 บาท'), []);
  assert.deepEqual(missing('บริจาค 12,500 บาท', 'ชาวบ้านช่วยกันบริจาค 1,250 บาท'), ['12,500 บาท']);
  assert.deepEqual(missing('ไม่มีตัวเลขเลย', 'อะไรก็ได้'), []);
});

test('A5 สวิตช์ถอย RAW_FACT_PRESENCE_WARN=0/off/false/no (ทนอัญประกาศ) = ไม่เช็ค ไม่ติดป้าย', async () => {
  for (const v of ['0', 'off', 'false', 'no', '"0"', ' OFF ']) {
    await withEnv({ RAW_FACT_PRESENCE_WARN: v }, () => {
      assert.equal(RFP.isRawFactPresenceWarnEnabled(), false, JSON.stringify(v));
      const vs = [{ content: 'ไม่มีวันที่' }];
      assert.equal(RFP.annotateMissingRawFacts(vs, RAW).versions, vs);
    });
  }
  for (const v of [undefined, '', '1', 'on']) {
    await withEnv({ RAW_FACT_PRESENCE_WARN: v }, () => assert.equal(RFP.isRawFactPresenceWarnEnabled(), true, JSON.stringify(v)));
  }
});

test('A6 ป้ายเดิมของฉบับ (ถ้ามี) ถูกต่อท้าย ไม่ทับ ไม่ซ้ำ', () => {
  const v = { content: 'ไม่มีอะไรเลย', _missingFacts: { checked: true, source: 'other', missing: [{ type: 'name', text: 'ชื่อคน' }, { type: 'date', text: '17 ตุลาคม' }] } };
  const out = RFP.annotateMissingRawFacts([v], RAW).versions[0]._missingFacts;
  assert.equal(out.source, 'other');
  assert.deepEqual(out.missing.map((m) => m.text), ['ชื่อคน', '17 ตุลาคม', 'วัย 81 ปี']);
});

const AUTO_SRC = readFileSync(new URL('../src/lib/services/autoFlowServiceText.js', import.meta.url), 'utf8');
const SUM_SRC = readFileSync(new URL('../src/lib/services/summarizeServiceText.js', import.meta.url), 'utf8');

test('B1 ต่อเข้าท่อ: เรียกหลังด่านความยาว (เห็นเนื้อสุดท้าย) และก่อนประกอบผล', () => {
  assert.match(AUTO_SRC, /import \{ annotateMissingRawFacts \} from '@\/lib\/services\/rawFactPresence'/u);
  const call = AUTO_SRC.indexOf('annotateMissingRawFacts(finalVersions, groundingSourceText)');
  const floor = AUTO_SRC.indexOf('enforceTextNewsPublicationFloor(finalVersions');
  const build = AUTO_SRC.indexOf('buildPublishableAnalysisResult({');
  assert.ok(floor > 0 && call > floor && build > call, 'ลำดับต้องเป็น ด่านความยาว → ติดป้าย → ประกอบผล');
});

test('A7 รอบ 3 (ผู้ตรวจรอบ 2): เงินหน่วยผสม = จำนวนเดียว · ฝั่งดิบต้องมี "บาท" · ป้ายอายุใช้คำตามต้นฉบับ', () => {
  assert.deepEqual(labels('ได้เงิน 2 หมื่น 5 พันบาท และ 1 ล้าน 2 แสนบาท'), ['2 หมื่น 5 พันบาท', '1 ล้าน 2 แสนบาท']);
  assert.deepEqual(missing('ได้เงิน 2 หมื่น 5 พันบาท', 'ได้ 25,000 บาท'), []);
  assert.deepEqual(missing('ได้ 25,000 บาท', 'ราวสองหมื่นห้าพันบาท'), []);
  assert.deepEqual(missing('ยอด 1 ล้าน 2 แสนบาท', 'ยอด 1.2 ล้านบาท'), []);
  assert.deepEqual(missing('ยอด 1 ล้าน 2 แสนบาท', 'ยอด 2 แสนบาท'), ['1 ล้าน 2 แสนบาท'], 'ค่าคนละจำนวนยังต้องจับ');
  assert.deepEqual(labels('ยอดวิวทะลุ 1 ล้าน! ถูกรางวัล 6 ล้าน'), [], 'ไม่มี "บาท" = ไม่นับเป็นเงิน');
  assert.deepEqual(labels('คุณตาอายุ 92 ปี · หลานวัย 5 ขวบ'), ['อายุ 92 ปี', 'วัย 5 ขวบ']);
});

test('A8 รอบ 4 (ผู้ตรวจรอบ 3): คำไทยหน่วยผสม/ร้อย · ฿ · "ส.ค.ส." ไม่ใช่วันที่ · ยังจับค่าคนละจำนวน', () => {
  assert.deepEqual(missing('ได้ 15,000 บาท', 'ได้หมื่นห้าพันบาท'), []);
  assert.deepEqual(missing('ราคา ฿500', 'ราคา 500 บาท'), []);
  assert.deepEqual(missing('ราคา 500 บาท', 'ราคา ฿500'), []);
  assert.deepEqual(missing('บ้านอายุ 100 ปี', 'บ้านอายุร้อยปี'), []);
  assert.deepEqual(labels('แจก 1 ส.ค.ส. ให้เด็ก'), []);
  assert.deepEqual(labels('วันที่ 1 ส.ค. 69'), ['1 สิงหาคม']);
  assert.deepEqual(missing('ได้ 15,000 บาท', 'ได้ 1,500 บาท'), ['15,000 บาท']);
  // รอบ 5 (ผู้ตรวจรอบ 4): ฿ ตามด้วยหน่วยคูณ ≠ บาทเปล่า · "ตุลาคมพ.ศ." ไม่เว้นวรรคยังเป็นวันที่
  assert.deepEqual(missing('ระดมทุน ฿1.2 ล้าน', 'ระดมทุน 1.2 ล้านบาท'), []);
  assert.deepEqual(missing('ระดมทุน ฿5 แสนบาท', 'ระดมทุน 500,000 บาท'), []);
  assert.deepEqual(labels('วันที่ 17 ตุลาคมพ.ศ.2569'), ['17 ตุลาคม']);
});

const withRule = (v, fn) => { const k = process.env.WRITER_KEEP_FACTS_RULE; if (v === undefined) delete process.env.WRITER_KEEP_FACTS_RULE; else process.env.WRITER_KEEP_FACTS_RULE = v; try { return fn(); } finally { if (k === undefined) delete process.env.WRITER_KEEP_FACTS_RULE; else process.env.WRITER_KEEP_FACTS_RULE = k; } };

test('C1 กฎใบสั่งเขียน: ระบุวันที่ = คงไว้ · ไม่ระบุ = ห้ามเติม · ไม่มีตัวอย่างผูกเคสข่าว · ใบสั่งเรียกฟังก์ชันจริง', () => {
  const rule = RFP.WRITER_KEEP_FACTS_RULE_TEXT;
  assert.match(rule, /ถ้าข้อความดิบระบุวันที่หรือเวลา ต้องใส่ไว้ในเนื้อข่าวทุกเวอร์ชัน ห้ามตัดทิ้ง.*ถ้าไม่ระบุ ห้ามเติมวันที่\/เวลาเอง/u);
  assert.match(rule, /ถ้าต้นฉบับเล่าเสียงตอบรับหรือคำชม \(มักอยู่ท้ายต้นฉบับ\) ต้องมีในเนื้อข่าวด้วย/u);
  assert.match(rule, /\n$/u, 'ต้องจบด้วยขึ้นบรรทัด (ต่อกับกฎข้อถัดไปในใบสั่ง)');
  assert.doesNotMatch(rule, /สั่งให้ญาติโทร|ต้องมีวันที่และเวลาของเหตุการณ์ในเนื้อข่าวเสมอ/u);
  assert.match(SUM_SRC, /import \{ writerKeepFactsRuleLine \} from '@\/lib\/services\/rawFactPresence'/u);
  assert.match(SUM_SRC, /\n\s+writerKeepFactsRuleLine\(\) \+\r?\n\s+'- ⚠️ ห้ามตั้งคำถามปิดท้ายเด็ดขาด/u, 'ต้องต่อในใบสั่งเขียน ก่อนกฎห้ามคำถามปิดท้าย');
  assert.doesNotMatch(SUM_SRC, /process\.env\.WRITER_KEEP_FACTS_RULE/u, 'ห้ามอ่าน env เองในใบสั่ง — ใช้ตัวอ่านกลาง');
});

test('C2 สวิตช์ถอย WRITER_KEEP_FACTS_RULE ทนอัญประกาศ/off/false/no: ปิด = ไม่มีกฎ (ใบสั่งเหมือนก่อน 25 ต.ค.) · เปิด = มีกฎ', () => {
  for (const v of ['0', '"0"', ' off ', 'FALSE', 'no']) withRule(v, () => {
    assert.equal(RFP.isWriterKeepFactsRuleEnabled(), false, JSON.stringify(v));
    assert.equal(RFP.writerKeepFactsRuleLine(), '', JSON.stringify(v));
  });
  for (const v of [undefined, '', '1', 'on']) withRule(v, () => {
    assert.equal(RFP.isWriterKeepFactsRuleEnabled(), true, JSON.stringify(v));
    assert.equal(RFP.writerKeepFactsRuleLine(), RFP.WRITER_KEEP_FACTS_RULE_TEXT, JSON.stringify(v));
  });
});
