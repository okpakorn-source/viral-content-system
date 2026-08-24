import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const VIEW_PATH = new URL('../src/components/content/ResultVersions.js', import.meta.url);
const LOG_VIEW_PATH = new URL('../src/app/generation-logs/page.js', import.meta.url);
const MOBILE_VIEW_PATH = new URL('../src/app/m/page.js', import.meta.url);
const WRITER_PATH = new URL('../src/lib/services/summarizeServiceText.js', import.meta.url);
const POST_TEXT_PATH = new URL('../src/lib/utils/publishablePostText.js', import.meta.url);

function makePublishablePostText(source = readFileSync(POST_TEXT_PATH, 'utf8')) {
  const start = source.indexOf('export function getPublishablePostText(');
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'ต้องพบ getPublishablePostText ตัวจริง');
  const declaration = source.slice(start, end + 2).replace('export function', 'function');
  return new Function(`${declaration}; return getPublishablePostText;`)();
}

function makeBuildPostText(source = readFileSync(VIEW_PATH, 'utf8')) {
  const start = source.indexOf('export function buildPostText(');
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'ต้องพบ buildPostText ตัวจริง');
  const declaration = source.slice(start, end + 2).replace('export function', 'function');
  return new Function('getPublishablePostText', `${declaration}; return buildPostText;`)(makePublishablePostText());
}

test('ข้อความคัดลอกมีเฉพาะเนื้อพร้อมโพสต์ ไม่แปะ title/hook/closing แยก', () => {
  const buildPostText = makeBuildPostText();
  const version = {
    title: 'พาดหัวที่เก็บหลังบ้าน',
    hook: 'ฮุกที่เป็น metadata',
    content: '  ประโยคเปิดที่เล่าจุดขายอย่างลื่น\n\nเนื้อข่าวย่อหน้าถัดไป  ',
    closing: 'ประโยคปิดที่มีอยู่ในเนื้อแล้ว',
  };
  assert.equal(
    buildPostText(version),
    'ประโยคเปิดที่เล่าจุดขายอย่างลื่น\n\nเนื้อข่าวย่อหน้าถัดไป',
  );
});

test('หน้าแสดงผลใช้ post text เดียวกับปุ่มคัดลอกและไม่แสดง metadata ซ้ำ', () => {
  const source = readFileSync(VIEW_PATH, 'utf8');
  assert.match(source, /copyText\(buildPostText\(v\), `v\$\{i\}`\)/u);
  assert.doesNotMatch(source, /v\.title \+ '\\n\\n'/u);
  assert.doesNotMatch(source, /\{v\.title && <div/u);
  assert.doesNotMatch(source, /\{v\.hook && <div/u);
  assert.doesNotMatch(source, /\{v\.closing && <div/u);
});

test('Generation Logs และมือถือแสดง/คัดลอกเฉพาะ publishable content เดียวกัน', () => {
  const logSource = readFileSync(LOG_VIEW_PATH, 'utf8');
  const mobileSource = readFileSync(MOBILE_VIEW_PATH, 'utf8');
  assert.match(logSource, /copyText\(getPublishablePostText\(v\)/u);
  assert.match(logSource, /\{getPublishablePostText\(v\)\}/u);
  assert.doesNotMatch(logSource, /v\.title \? v\.title \+ '\\n\\n'/u);
  assert.doesNotMatch(logSource, /\{v\.title && <div/u);
  assert.match(mobileSource, /copyText\(getPublishablePostText\(cur\)/u);
  assert.match(mobileSource, /copyText\(getPublishablePostText\(v\)/u);
  assert.doesNotMatch(mobileSource, /\{cur\.title && <p/u);
  assert.doesNotMatch(mobileSource, /\{v\.title && <p/u);
});

test('นักเขียนถูกสั่งให้ content ยืนได้เองและรวมจุดขายโดยไม่วางพาดหัวซ้ำ', () => {
  const source = readFileSync(WRITER_PATH, 'utf8');
  assert.match(source, /เนื้อหาเป็นข้อความที่พนักงานนำไปโพสต์โดยตรงและจะไม่แสดง title แยก/u);
  assert.match(source, /ย่อหน้าแรกต้องยืนได้เอง/u);
  assert.match(source, /ห้ามวาง title ซ้ำเป็นบรรทัดก่อนเนื้อหา/u);
  assert.match(source, /ห้ามพูดใจความเดียวกันซ้ำสองรอบติดกัน/u);
});

test('mutation: คืนพาดหัวเข้า clipboard หรือถอดกฎ standalone แล้ว oracle ต้องแดง', () => {
  const postTextSource = readFileSync(POST_TEXT_PATH, 'utf8');
  const copiedTitle = postTextSource.replace(
    "return String(version?.content || '').trim();",
    "return (version?.title ? version.title + '\\n\\n' : '') + String(version?.content || '').trim();",
  );
  assert.notEqual(copiedTitle, postTextSource);
  assert.match(makePublishablePostText(copiedTitle)({ title: 'หัว', content: 'เนื้อ' }), /^หัว/u);

  const writerSource = readFileSync(WRITER_PATH, 'utf8');
  const noStandalone = writerSource.replace('ย่อหน้าแรกต้องยืนได้เอง', 'ย่อหน้าแรกเขียนอะไรก็ได้');
  assert.notEqual(noStandalone, writerSource);
  assert.doesNotMatch(noStandalone, /ย่อหน้าแรกต้องยืนได้เอง/u);
});
