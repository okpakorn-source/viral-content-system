import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PATH = new URL('../src/lib/services/autoFlowServiceText.js', import.meta.url);

function makeAssess(source = readFileSync(PATH, 'utf8')) {
  const start = source.indexOf('export function assessRawTextSafety(');
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'ต้องพบบล็อก assessRawTextSafety ตัวจริง');
  const declaration = source.slice(start, end + 2).replace('export function', 'function');
  return new Function(`${declaration}; return assessRawTextSafety;`)();
}

function article(content) {
  return [{ title: 'พาดหัว', content }];
}

function assertHealthAuthority(assess) {
  const rawPlain = 'ช็อกโกแลตช่วยให้ผ่อนคลาย';
  assert.equal(
    assess(article(rawPlain), rawPlain).ok,
    true,
    'RAW ไม่ระบุที่มา ต้องเขียนตาม RAW ได้โดยไม่สร้าง catch-22',
  );

  const invented = assess(article('แพทย์แนะนำว่าช็อกโกแลตช่วยให้ผ่อนคลาย'), rawPlain);
  assert.equal(invented.ok, false, 'ห้ามเสกแพทย์เป็นที่มาเมื่อ RAW ไม่มี');
  assert.ok(invented.issues.some(issue => issue.includes('เพิ่มที่มา')));

  const rawAttributed = 'แม่เล่าว่าได้รับคำแนะนำให้กินช็อกโกแลตเพื่อช่วยให้ผ่อนคลาย';
  assert.equal(assess(article(rawAttributed), rawAttributed).ok, true);
  const stripped = assess(article('ช็อกโกแลตช่วยให้ผ่อนคลาย'), rawAttributed);
  assert.equal(stripped.ok, false, 'RAW มีที่มา นักเขียนต้องคงที่มาไว้');
  assert.ok(stripped.issues.some(issue => issue.includes('ไม่ระบุที่มา')));

  const mixedRaw = [
    'ช็อกโกแลตช่วยให้ผ่อนคลาย',
    'แพทย์แนะนำว่ายาแก้ไอช่วยลดอาการไอ',
  ].join('\n');
  assert.equal(
    assess(article('ยาแก้ไอช่วยลดอาการไอ'), mixedRaw).ok,
    false,
    'ข้อความช็อกโกแลตที่ไม่มีที่มา ห้ามอนุญาตให้ตัดที่มาจากข้อความยา',
  );
  assert.equal(
    assess(article('แพทย์แนะนำว่าช็อกโกแลตช่วยให้ผ่อนคลาย'), mixedRaw).ok,
    false,
    'ข้อความยาที่มีแพทย์ ห้ามอนุญาตให้เสกแพทย์ให้ข้อความช็อกโกแลต',
  );

  const sameParagraphRaw = 'แพทย์แนะนำให้กินยาเพื่อช่วยลดอาการปวด แต่ช็อกโกแลตช่วยให้ผ่อนคลาย';
  assert.equal(
    assess(article('ช็อกโกแลตช่วยให้ผ่อนคลาย'), sameParagraphRaw).ok,
    true,
    'สองข้ออยู่บรรทัดเดียวกันต้องยังจับคู่ที่มารายข้อได้',
  );
  assert.equal(
    assess(article('แพทย์แนะนำว่าช็อกโกแลตช่วยให้ผ่อนคลาย'), sameParagraphRaw).ok,
    false,
    'ที่มาของยาห้ามข้ามคำว่า แต่ มาเป็นที่มาของช็อกโกแลต',
  );

  const timedRaw = 'แม่เล่าว่าได้รับคำแนะนำให้รับประทานช็อกโกแลตช่วง 19.00 น. เพื่อช่วยให้ผ่อนคลาย';
  assert.equal(
    assess(article('แม่เล่าว่าได้รับคำแนะนำให้กินช็อกโกแลตเพื่อช่วยให้ผ่อนคลาย'), timedRaw).ok,
    true,
    'เวลา 19.00 น. ห้ามตัด claim กับที่มาออกจากกัน',
  );
}

test('ด่านสุขภาพใช้ RAW เป็นอำนาจ: ไม่บังคับเติมที่มาและไม่ยอมให้เสกที่มา', () => {
  assertHealthAuthority(makeAssess());
});

test('mutations: ถอดสิทธิ์ RAW ไม่มีที่มาหรือถอดด่านเสกที่มาแล้วต้องแดง', () => {
  const source = readFileSync(PATH, 'utf8');
  const rejectFaithful = source.replace(
    'if (hasHealthBenefit && !hasAttribution && !healthAuthority?.unattributed) {',
    'if (hasHealthBenefit && !hasAttribution) {',
  );
  assert.notEqual(rejectFaithful, source, 'mutation ต้องแก้ด่าน faithful ใน production ได้จริง');
  assert.throws(() => assertHealthAuthority(makeAssess(rejectFaithful)));

  const allowInventedAttribution = source.replace(
    'if (hasHealthBenefit && hasAttribution && !healthAuthority?.attributed) {',
    'if (false) {',
  );
  assert.notEqual(allowInventedAttribution, source, 'mutation ต้องแก้ด่าน invented attribution ได้จริง');
  assert.throws(() => assertHealthAuthority(makeAssess(allowInventedAttribution)));

  const crossClaimAuthority = source.replace(
    'return category && effect ? `${category}|${effect}` : \'\';',
    "return category && effect ? 'all-health-claims' : '';",
  );
  assert.notEqual(crossClaimAuthority, source, 'mutation ต้องทำให้ key ราย claim พังได้จริง');
  assert.throws(() => assertHealthAuthority(makeAssess(crossClaimAuthority)));
});
