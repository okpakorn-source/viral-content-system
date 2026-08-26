/**
 * เทสพฤติกรรมจริงของปุ่มคัดลอก (ปิดช่องว่างที่ผู้ตรวจอิสระชี้ 26 ส.ค. 69)
 *
 * บั๊ก UI-01 ของจริง: หน้าประกาศ copy(text, key) แต่การ์ดเรียก onCopy(key, text)
 *   → คลิปบอร์ดได้ "id ของปุ่ม" แทนเนื้อข่าว และไฟ "คัดลอกแล้ว" ไปติดผิดปุ่ม
 * เทสเดิมตรวจแค่ว่าซอร์สทั้งสองฝั่งเขียน signature ตรงกัน — ถ้าใครสลับ argument
 *   ตอน "ส่งต่อ" ข้างในการ์ดโดยไม่แตะ signature เทสนั้นจะไม่แดง
 * เทสนี้จึงเรนเดอร์การ์ดจริงแล้วกดปุ่มจริง ดูว่าอะไรถูกส่งเข้าคลิปบอร์ด
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');

const SRC = new URL('../src/app/clip-transcript/ui/InsightCard.js', import.meta.url);

/** แปลง JSX เป็น JS แล้วรันในกล่องปิด (เปลี่ยน import ที่ไม่เกี่ยวเป็นของปลอม) */
function loadInsightCard() {
  const code = readFileSync(SRC, 'utf8');
  const out = ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const fakeModules = {
    react: React,
    './statusMeta': {
      platformIcon: () => '🎬', fmtDurSec: () => '1:00 นาที', fmtMs: () => '30 วิ', fmtClock: () => '26 ส.ค. 12:00',
      getBrainMeta: () => null,
    },
    '@/lib/services/clipNewsReadyText': {
      buildClipNewsReadyText: (ins) => `เนื้อพร้อมใช้: ${ins?.rawData || ''}`,
      buildClipSubStoryText: (s) => `ก้อนย่อย: ${s?.rawData || ''}`,
    },
    './BrainBox': { __esModule: true, default: () => null },
  };
  const module = { exports: {} };
  const localRequire = (name) => {
    if (name in fakeModules) return fakeModules[name];
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    return require(name);
  };
  // ts เปลี่ยน JSX เป็น React.createElement — ต้องมี React ในขอบเขตที่รัน
  new Function('require', 'module', 'exports', 'React', out)(localRequire, module, module.exports, React);
  return module.exports.default || module.exports;
}

/** เดินต้นไม้ element หาปุ่มที่ข้อความตรงเงื่อนไข แล้วกด onClick */
function clickButton(el, matcher, found = { hit: false }) {
  if (!el || typeof el !== 'object' || found.hit) return found;
  if (Array.isArray(el)) { el.forEach((c) => clickButton(c, matcher, found)); return found; }
  const text = collectText(el);
  if (el.type === 'button' && matcher(text)) {
    el.props?.onClick?.();
    found.hit = true;
    return found;
  }
  const kids = el.props?.children;
  if (kids != null) clickButton(kids, matcher, found);
  return found;
}
function collectText(el) {
  if (el == null || typeof el === 'boolean') return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(collectText).join('');
  return collectText(el.props?.children);
}
/** เรนเดอร์ component ที่มี useState ให้ได้ต้นไม้ element (ไม่ต้องใช้ react-dom) */
function renderTree(Comp, props) {
  const hooks = [];
  let i = 0;
  const dispatcher = {
    useState: (init) => {
      const idx = i++;
      if (hooks.length <= idx) hooks[idx] = typeof init === 'function' ? init() : init;
      return [hooks[idx], (v) => { hooks[idx] = typeof v === 'function' ? v(hooks[idx]) : v; }];
    },
  };
  const RD = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
    || React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = RD.H;
  RD.H = dispatcher;
  try { return Comp(props); } finally { RD.H = prev; }
}

const REC = {
  id: 'case-1',
  url: 'https://youtu.be/abc',
  platform: 'youtube',
  title: 'หัวข้อทดสอบ',
  insight: {
    headline: 'หัวข้อทดสอบ',
    overview: 'ภาพรวมทดสอบ',
    rawData: 'เนื้อดิบของจริงที่ต้องเข้าคลิปบอร์ด',
    quotes: ['คำพูดหนึ่ง'],
    keyPoints: [],
    subStories: [],
    speakers: ['ผู้ให้สัมภาษณ์'],
  },
};

test('ปุ่ม "คัดลอกเนื้อพร้อมใช้" ต้องส่ง (key, ข้อความจริง) เข้า onCopy — ไม่ใช่สลับกัน', () => {
  const InsightCard = loadInsightCard();
  const calls = [];
  const tree = renderTree(InsightCard, { rec: REC, live: true, copiedKey: '', onCopy: (a, b) => calls.push([a, b]) });

  const found = clickButton(tree, (t) => /คัดลอกเนื้อพร้อมใช้/.test(t));
  assert.ok(found.hit, 'ต้องเจอปุ่มคัดลอกเนื้อพร้อมใช้ในการ์ด');
  assert.equal(calls.length, 1, 'กดหนึ่งครั้งต้องเรียก onCopy หนึ่งครั้ง');

  const [key, text] = calls[0];
  // อาร์กิวเมนต์ที่ 1 = คีย์ปุ่ม (สั้น ไม่ใช่เนื้อข่าว) · อาร์กิวเมนต์ที่ 2 = ข้อความที่จะเข้าคลิปบอร์ด
  assert.equal(typeof key, 'string');
  assert.equal(typeof text, 'string');
  assert.ok(text.includes('เนื้อดิบของจริงที่ต้องเข้าคลิปบอร์ด'),
    `อาร์กิวเมนต์ที่ 2 ต้องเป็นเนื้อข่าวจริง แต่ได้: ${text.slice(0, 60)}`);
  assert.ok(!key.includes('เนื้อดิบของจริง'),
    `อาร์กิวเมนต์ที่ 1 ต้องเป็นคีย์ปุ่ม ไม่ใช่เนื้อข่าว แต่ได้: ${key.slice(0, 60)}`);
  assert.ok(key.length < 60, 'คีย์ปุ่มต้องสั้น (เป็น id ไม่ใช่เนื้อ)');
});

test('ปุ่มคัดลอกคำพูด ก็ต้องส่ง (key, ข้อความ) ตามสัญญาเดียวกัน', () => {
  const InsightCard = loadInsightCard();
  const calls = [];
  const tree = renderTree(InsightCard, { rec: REC, live: true, copiedKey: '', onCopy: (a, b) => calls.push([a, b]) });

  // ปุ่มคัดลอกอื่นๆ ในการ์ด (ก้อนรวม/คำพูด) ต้องเป็นสัญญาเดียวกันหมด
  const all = [];
  (function walk(el) {
    if (!el || typeof el !== 'object') return;
    if (Array.isArray(el)) return el.forEach(walk);
    if (el.type === 'button' && el.props?.onClick) all.push(el);
    if (el.props?.children != null) walk(el.props.children);
  })(tree);

  const copyButtons = all.filter((b) => /คัดลอก|📋/.test(collectText(b)));
  assert.ok(copyButtons.length >= 1, 'ต้องมีปุ่มคัดลอกอย่างน้อยหนึ่งปุ่ม');
  copyButtons.forEach((b) => b.props.onClick());

  assert.ok(calls.length >= 1);
  calls.forEach(([key, text]) => {
    assert.equal(typeof key, 'string', 'อาร์กิวเมนต์ที่ 1 ต้องเป็นคีย์');
    assert.equal(typeof text, 'string', 'อาร์กิวเมนต์ที่ 2 ต้องเป็นข้อความ');
    assert.ok(key.length < 60, `คีย์ต้องสั้น แต่ได้ยาว ${key.length} ตัว (แปลว่าสลับ argument)`);
  });
});
