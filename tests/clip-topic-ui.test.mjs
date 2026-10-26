/**
 * การ์ดผลถอดคลิป + ข้อความคัดลอก (★ 26 ต.ค. 69 ระบบถอดคลิปเฟส 4)
 *   การ์ดประเด็นย่อย (TopicCard) · กล่องสมอง (BrainBox) · ตัว normalize ของเครื่องยนต์เดิม ถูกลบพร้อมเครื่องยนต์เดิม
 *   คงไว้: ไบต์คัดลอกของ clipNewsReadyText (/m ยังใช้) · การ์ดช่องเดียวแสดงใบเก่าจริงในคลัง/ใบ v2/ใบระบบใหม่
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as status from '../src/app/clip-transcript/ui/statusMeta.js';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const UI = new URL('../src/app/clip-transcript/ui/', import.meta.url);
const source = (name) => readFileSync(new URL(name, UI), 'utf8');
const readCopy = readFileSync(new URL('../src/lib/services/clipNewsReadyText.js', import.meta.url), 'utf8');
const mutation = process.env.CLIP_TOPIC_UI_MUTATION;
const copySource = mutation === 'quotes' ? readCopy.replace("quote?.verification === 'verified'", 'true') : readCopy;
const copy = await import('data:text/javascript,' + encodeURIComponent(copySource));
// Immutable pre-P5 source snapshots: captured before edits, not recomputed by tests.
const BASE_COPY = 'eJyVVltrG0cUfjf4PxwXYe3a6srto4MimrZvaWijvMkqWkkjedPVrro7qq3KAiUVuGnpUxuKLwnYJhgaArXTkNG/GfRLypyZWc2uZKcFgXbO9TuXOWeaYRBTaPrEDaAE1g+u3yc2lO5ChUZe0JEEODiAfN52aOR1LfvO6srqSrsfNKkXBlL1m35IiVYerq4ARIT2I8WVjLLzvZAStqSgE5Ge7zaJVfy2Ohuf7nyUr20eVGfjF/iVK3YKaaejlN+uF8de0EHPj8g+tRpha1AA9FEJ+1GTxFCCak3haWKcQRh1Xd/7kbTuha0BlBQ+oWrA2Yk30TnkhVutGxMiUhSQPagQapksdCrcmd4FG8Bp+y79yu1ZVoxkzO1nUeQOHC/G/4RRBvkF2wK2Uu+6PWueYk1tez4lkWWhPzQ5lBwArw3WWpJpAdrZdWMlaeu6tF0/Jne0Dkq5rZaSSuhKeC2dNscLmn6/RZTRpXnTNkbyQxmSeXJ8EnTorhQoQ52zCWdvOXvJ2ZSzPzj7C48Tzq44+42znzm75uwJUl5x9g9nJ9s7QW6orIkMGYmoz8anijeajV/Ubedx6AVWfifI26O6dLoN+fxCQ1GvS+67DeJbMXUjWgAStFLN4yb9ggJmAzQSllBCBtbBhfV1WGskaUe3STrquaGLV6ucH83Gv+eGDX2qa3RkvxdGFBKQjb7ntz73vV6l36jQMBpg68fiqwBe0CL7UIKtFGwa9rymAT2MBmVHEkWDqLNHfZKKyLwfSihy975wqWuoxf1u140GRsR4lTLh6rsHJXjQ7zZIpA0GoS2MSdyb8IkhLaqxANrrkodu0CGoZdYrYVdk6QzKl7og0q4vNKCksoLdd8LZBWd/8+lYdN/0kLMjyA2DcLQNuSHKjXJDxFOGOljye2TXsY1Gdd1NSVmr6KMAciDdMKeqCqJs4ppd03f6XhiKmOdtKxp3oVmxD+6TjtscPBII0TJiVW2QGXvz1KPQB1JP/XnulbwkirSrs/izbypYorS8YAZbFcyg3FCw2wolSiLglaGONRMHVZhbS2dOd9nJ2Qg0eR64ugQmxF7oBVSM//RcVwrfkcHXKGDriYeMOV1OMDSCE0wCwHPZwT/hXvLthTbJKNdn43PIDZEwSg2/1Ohb2FxLoUtuBrcxdpsSwlJI/20iZ0BlbpDKfkFlWG33+Oa7Mr8pxY2N1RXYAM6e8ukzzt7g+rjEVXLG2WtcJVe4VuS6eY3NdcXZMW6iI809RJUj/L3l04loQ9GA0uy1akmhdczZn2jqKZ/KnXW5jRg+BtS44Ow9ct4Iq7KJ2TvOzoUg8OlPnP3Cp89Aj1kUealFDgUaFclRRlt7UWFdC+qCR9NFLLeHR2JA0O9QaoIaxyh2xNlzTMElWhIGAKM/Q9Hn0qzGWpQPDtS/xAT/iliTvL5HEydoN8nc2SLIJJILlaZ5UU45ewXdvk89nHhShqGmzMcTnfYkoHPUPURT1/iQmGjfhzrKie4E9F28ZeU+IHvxQ+K25M71gtjr7FI1Z3H3KRIOi0GPhG3QlLVSCfJh4zFp0nx6O2plJekYAa6vZ26llsF7GNtCIE1SLytbvwaVo4yQuJ7L9sfiRc6sIICRBKxHZtJE2fmhPc5FkiGyyEpes7gSjRGYfnbYybCo1pL3hmFFxg53S/BpNgGGVBJ89hH1f6PXt1QvDB1Xaj8IiJqQwVRNHtmSX9DnhQeDFoCq9iHHYMGIq7pVm78llKkPPikwoiVJqm7VoHzTU9OUKoin5vwx/S8fgYjj';
const unpack = (s) => inflateSync(Buffer.from(s, 'base64')).toString('utf8');
const legacyCopy = await import('data:text/javascript,' + encodeURIComponent(unpack(BASE_COPY)));
function mutate(code, before, after) {
  assert.ok(code.includes(before), `Mutation anchor missing: ${mutation}`);
  return code.replace(before, after);
}
function loadUI(name) {
  let code = source(name);
  if (mutation === 'card-checks' && name === 'InsightCard.js') code = mutate(code, '{view.checks.length > 0 && (', '{false && (');
  const out = ts.transpileModule(code, { compilerOptions: {
    jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const localRequire = (spec) => {
    if (spec === 'react') return React;
    if (spec === './statusMeta') return status;
    throw new Error('Unexpected UI dependency: ' + spec);
  };
  const sandboxModule = { exports: {} };
  new Function('require', 'module', 'exports', 'React', out)(localRequire, sandboxModule, sandboxModule.exports, React);
  return sandboxModule.exports;
}
const { default: InsightCard } = loadUI('InsightCard.js');
const story = (extra = {}) => ({ id: 's1', topic: 'หัวเรื่องแสดงแยก', highlight: 'ไฮไลท์แสดงแยก', story: 'เนื้อประโยคแรก\n  ประโยคต่อมา\nประโยคสุดท้าย',
  facts: [{ text: 'ข้อเท็จจริงหนึ่ง' }], quotes: [
    { text: 'ยืนยันข้อความนี้แล้ว', speaker: 'ผู้พูด', verification: 'verified' },
    { text: 'ยังตรวจไม่ผ่าน', verification: 'unverified' },
    { text: 'รอตรวจคำพูด', verification: 'pending' },
    { text: 'ยืนยันอีกข้อความ', verification: 'verified' },
  ], quality: { status: 'checked', issues: [] }, standalone: true, overlaps: [], sharePct: 40, ...extra });
const readyExpected = 'เนื้อประโยคแรก ประโยคต่อมา ประโยคสุดท้าย\nคำพูด (ผู้พูด): "ยืนยันข้อความนี้แล้ว"\nคำพูด: "ยืนยันอีกข้อความ"';
const text = (el) => el == null || typeof el === 'boolean' ? '' : typeof el !== 'object' ? String(el) : Array.isArray(el) ? el.map(text).join('') : text(el.props?.children);
function nodes(el, predicate, found = []) {
  if (!el || typeof el !== 'object') return found;
  if (Array.isArray(el)) { el.forEach((e) => nodes(e, predicate, found)); return found; }
  if (predicate(el)) found.push(el);
  nodes(el.props?.children, predicate, found);
  return found;
}
function renderer(Comp, props) {
  const hooks = [];
  return () => {
    let i = 0;
    const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const prev = internals.H;
    internals.H = { useState(init) { const idx = i++; if (idx >= hooks.length) hooks[idx] = init; return [hooks[idx], (v) => { hooks[idx] = v; }]; } };
    try { return Comp(props); } finally { internals.H = prev; }
  };
}

const FIXTURES = new URL('./fixtures/clip-topic-v2/', import.meta.url);
const archivePath = fileURLToPath(new URL('archive-3.json', FIXTURES));
const ids = ['046cde94-7185-474d-8438-5cc07bf3232b', '1ee5287f-3efb-4b3a-a61d-801bc5f0fb16', '950d07c0-5183-47f2-9055-963fad766fef'];
const archive = JSON.parse(readFileSync(archivePath, 'utf8'));

for (const id of ids) test(`legacy real archive ${id}: copy bytes unchanged and single card shows original full body`, () => {
  const rec = archive.find((r) => r.id === id);
  assert.ok(rec?.insight, 'Real archived record is required, no skip or synthetic fallback');
  assert.equal(rec.insight.topicsV2, undefined);
  assert.deepEqual(Buffer.from(copy.buildClipNewsReadyText(rec.insight)), Buffer.from(legacyCopy.buildClipNewsReadyText(rec.insight)));
  for (const [i, s] of (rec.insight.subStories || []).entries()) {
    assert.deepEqual(Buffer.from(copy.buildClipSubStoryText(s, i)), Buffer.from(legacyCopy.buildClipSubStoryText(s, i)));
  }
  const view = status.cardView(rec);
  assert.equal(view.legacy, true);
  assert.equal(view.headline, rec.insight.headline);
  assert.equal(view.body, rec.insight.rawData.trim(), 'ใบเก่าใช้ก้อนรวมเดิม (เนื้อครบที่สุด) ไม่ใช่สรุปสั้น');
  const calls = [];
  const tree = renderer(InsightCard, { rec, onCopy: (...a) => calls.push(a) })();
  nodes(tree, (e) => e.type === 'button' && /คัดลอกพาดหัว\+เนื้อข่าว/.test(text(e)))[0].props.onClick();
  assert.deepEqual(calls[0], [`ic-${id}-copy`, `${rec.insight.headline}\n\n${rec.insight.rawData.trim()}`]);
  const html = renderToStaticMarkup(React.createElement(InsightCard, { rec }));
  assert.match(html, /ใบรุ่นเก่า/);
  assert.doesNotMatch(html, /ประเด็นสำคัญ|เนื้อดิบแยกประเด็น|ผู้พูด:/);
  // ผู้ตรวจอิสระ 26 ต.ค.: ใบเก่าห้ามทิ้งข้อมูล — ธง "ต้องตรวจ" ของระบบเดิมเป็นจุดเช็ค · เนื้อแยกประเด็นพับไว้ใต้เนื้อ (ไม่อยู่ในข้อความคัดลอก)
  assert.equal(rec.insight.brain?.status, 'ต้องตรวจ');
  assert.match(html, /จุดที่ควรเช็ค 1 จุด[\s\S]*ผลตรวจระบบเดิม:<\/span> ระบบเดิมตรวจแล้วติดธง/);
  const subs = (rec.insight.subStories || []).filter((s) => String(s.rawData || '').trim());
  assert.equal(view.extras.length, subs.length);
  if (subs.length) {
    assert.match(html, new RegExp(`<details[^>]*><summary[^>]*>เนื้อแยกประเด็นของระบบเดิม \\(${subs.length}\\)</summary>`));
    assert.doesNotMatch(html, /<details[^>]*\bopen/, 'พับไว้เป็นค่าเริ่มต้น');
    // ข้อความคัดลอก = พาดหัว + เนื้อหลักเท่านั้น (ตรวจเท่ากันทั้งก้อนข้างบนแล้ว) — เนื้อแยกประเด็นไม่ต่อท้าย
  } else assert.doesNotMatch(html, /เนื้อแยกประเด็นของระบบเดิม/);
});

test('v2 verified copy is a single prose paragraph plus only verified quotes, without rewriting', () => {
  const input = story();
  const before = structuredClone(input);
  assert.equal(copy.buildClipTopicReadyText(input), readyExpected);
  assert.equal(copy.buildClipTopicReadyText(input).split('\n')[0], 'เนื้อประโยคแรก ประโยคต่อมา ประโยคสุดท้าย');
  assert.doesNotMatch(copy.buildClipTopicReadyText(input), /ยังตรวจไม่ผ่าน|รอตรวจคำพูด|หัวเรื่องแสดงแยก|ไฮไลท์แสดงแยก/);
  assert.equal(copy.buildClipTopicReadyText(story({ quotes: [{ text: '  ถ้อยคำ “เดิม”  ', verification: 'verified' }] })).split('\n')[1], 'คำพูด: "  ถ้อยคำ “เดิม”  "');
  assert.deepEqual(input, before);
});
test('v2 mainStory uses insight narrative and mainTopicId quotes even when order differs', () => {
  const input = { rawData: 'ห้ามใช้ rawData', mainStory: 'เรื่องหลัก\nคนละเนื้อกับเรื่องย่อย', topicsV2: { schemaVersion: 2, mainTopicId: 's2', mainStory: 'fallback', stories: [story(), story({ id: 's2', quotes: [{ text: 'ของเรื่องหลักเท่านั้น', verification: 'verified' }] })] } };
  assert.equal(copy.buildClipNewsReadyText(input), 'เรื่องหลัก คนละเนื้อกับเรื่องย่อย\nคำพูด: "ของเรื่องหลักเท่านั้น"');
  assert.equal(copy.buildClipNewsReadyText({ ...input, mainStory: '' }), 'คำพูด: "ของเรื่องหลักเท่านั้น"');
  assert.equal(copy.buildClipTopicReadyText(story(), { mainStory: 'กำหนด\nเนื้อหลัก' }).split('\n')[0], 'กำหนด เนื้อหลัก');
});
test('v2 legacy adapter uses storyId plus highlight/quality; plain legacy remains exact', () => {
  for (const mark of [{ highlight: '' }, { quality: { status: 'checked' } }]) {
    const s = { storyId: 's1', rawData: story().story, quotes: story().quotes, ...mark };
    assert.equal(copy.buildClipSubStoryText(s, 5), readyExpected);
  }
  const old = { topic: 'เรื่องเดิม', rawData: 'เนื้อ\nเดิม', quotes: ['คำพูดเดิม'], storyId: 'legacy-id' };
  assert.equal(copy.buildClipSubStoryText(old), legacyCopy.buildClipSubStoryText(old));
  assert.doesNotMatch(copy.buildClipSubStoryText({ ...old, highlight: 'v2' }), /คำพูดเดิม/);
});

test('ใบ v2 (มีเรื่องหลัก + ประเด็นย่อย) แสดงเนื้อเดียว · ประเด็นย่อยพับไว้ใต้เนื้อ ไม่แตกการ์ด', () => {
  const stories = [story({ id: 'a', topic: 'ประเด็นหนึ่ง', story: 'เนื้อประเด็นหนึ่ง' }), story({ id: 'b', topic: 'ประเด็นสอง', story: 'เนื้อประเด็นสอง' })];
  const rec = { id: 'v2-rec', insight: { headline: 'พาดหัว v2', rawData: 'ก้อนรวมทั้งคลิป', topicsV2: { schemaVersion: 2, mainStory: 'เรื่องหลักสั้น', mainTopicId: 'a', stories } } };
  const view = status.cardView(rec);
  assert.equal(view.legacy, true);
  assert.equal(view.body, 'ก้อนรวมทั้งคลิป', 'ก้อนรวมครบกว่าเรื่องหลักสั้น');
  assert.deepEqual(view.extras.map((x) => x.title), ['ประเด็นหนึ่ง', 'ประเด็นสอง']);
  const html = renderToStaticMarkup(React.createElement(InsightCard, { rec }));
  assert.match(html, /<details[^>]*><summary[^>]*>เนื้อแยกประเด็นของระบบเดิม \(2\)<\/summary>/);
  assert.doesNotMatch(html, /data-topic-id|เรื่องหลักทั้งคลิป|ต่อเนื่องจาก/);
  // ไม่มีก้อนรวม = ใช้เรื่องหลัก
  assert.equal(status.cardView({ insight: { topicsV2: { mainStory: 'เรื่องหลักสั้น', stories: [] } } }).body, 'เรื่องหลักสั้น');
});

test('การ์ดช่องเดียว (ใบระบบใหม่): พาดหัว · จุดที่ควรเช็คก่อนเนื้อ · คำพูดระบายสี · คัดลอกพาดหัว+เนื้อ · รายการที่โค้ดแก้พับไว้', () => {
  const rec = { id: 'single-1', url: 'https://www.tiktok.com/@a/video/1', platform: 'tiktok', insight: {
    engine: 'clip-single', headline: 'พาดหัวใหม่', body: 'ย่อหน้าแรก กล่าวว่า “คำพูดจริง” จบ\n\nย่อหน้าสอง', rawData: 'ย่อหน้าแรก กล่าวว่า “คำพูดจริง” จบ\n\nย่อหน้าสอง',
    checks: [
      { level: 'check', kind: 'number', text: 'ตัวเลข "19" ไม่พบในคลิป — ตรวจก่อนใช้' },
      { level: 'fixed', kind: 'quote', text: 'แก้คำพูดให้ตรงคลิป: “คำพูดจิง” → “คำพูดจริง”' },
      { level: 'check', kind: 'coverage', text: 'ประเด็นช่วง 0:00–6:00 อาจไม่ได้เขียนถึง: ช่วงเบื้องหลัง' },
    ] } };
  const view = status.cardView(rec);
  assert.equal(view.legacy, false);
  assert.deepEqual(view.checks.map((c) => c.kind), ['number', 'coverage']);
  assert.equal(view.fixed.length, 1);
  const calls = [];
  const tree = renderer(InsightCard, { rec, live: true, onCopy: (...a) => calls.push(a) })();
  nodes(tree, (e) => e.type === 'button' && /คัดลอกพาดหัว\+เนื้อข่าว/.test(text(e)))[0].props.onClick();
  assert.deepEqual(calls[0], ['ic-single-1-copy', `พาดหัวใหม่\n\n${rec.insight.body}`]);
  const html = renderToStaticMarkup(React.createElement(InsightCard, { rec, live: true }));
  assert.match(html, /จุดที่ควรเช็ค 2 จุด/);
  assert.match(html, /ตัวเลข:<\/span> ตัวเลข &quot;19&quot;/);
  assert.match(html, /ประเด็นอาจตกหล่น:/);
  assert.ok(html.indexOf('จุดที่ควรเช็ค') < html.indexOf('ย่อหน้าแรก'), 'จุดเช็คต้องอยู่ก่อนเนื้อข่าว ให้เห็นก่อนคัดลอก');
  assert.match(html, /<span style="[^"]*background[^"]*">“คำพูดจริง”<\/span>/);
  assert.match(html, /<details[^>]*><summary[^>]*>โค้ดแก้คำพูดให้ตรงคลิปแล้ว 1 จุด<\/summary>/);
  assert.doesNotMatch(html, /ใบรุ่นเก่า/);
  // ไม่มีจุดเช็ค = บอกว่าตรวจแล้วสะอาด
  const clean = renderToStaticMarkup(React.createElement(InsightCard, { rec: { ...rec, insight: { ...rec.insight, checks: [] } } }));
  assert.match(clean, /ตัวตรวจด้วยโค้ดไม่พบ/);
  assert.doesNotMatch(clean, /จุดที่ควรเช็ค/);
});
for (const [name, pattern] of [
  ['quotes', '^v2 verified copy'], ['card-checks', '^การ์ดช่องเดียว'],
]) {
  test(`mutation ${name}: actual behavioral assertion rejects defective source`, () => {
    const env = { ...process.env, CLIP_TOPIC_UI_MUTATION: name };
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, fileURLToPath(import.meta.url)], {
      encoding: 'utf8', timeout: 60000, env,
    });
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stdout + child.stderr, /AssertionError|ERR_ASSERTION/);
  });
}
