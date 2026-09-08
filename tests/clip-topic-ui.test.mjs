import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as metrics from '../src/lib/services/clipBrain/topicMetrics.js';
import * as status from '../src/app/clip-transcript/ui/statusMeta.js';
import { createFixtureRecord, runFixture } from '../scripts/clip-topic-v2-fixture.mjs';

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
const BASE_CARD = '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';
const unpack = (s) => inflateSync(Buffer.from(s, 'base64')).toString('utf8');
const legacyCopy = await import('data:text/javascript,' + encodeURIComponent(unpack(BASE_COPY)));
// SHA-256 recalculated once from fixtures/clip-topic-v2/archive-3.json for P5.2.
// The retained insight payloads produce the same six hashes as pre-P5.1.
// P3 additionally asserts deep equality against its immutable V8 snapshots.
const BASE_NORMALIZED = [
  ['42d1d8eacaa3219e385b4296b0461a590b4bcf04672884075a6253585412d48a', '42d1d8eacaa3219e385b4296b0461a590b4bcf04672884075a6253585412d48a'],
  ['14481e25df7ba4ac6e13907cd5c9e1eb4f0fbaa5b7c72a911b2381d086005843', '9c3a6265f678d3a8d0134ece587a2981a1269979688cf498d1cd687a413743c8'],
  ['a1a1663b25f0792d6cf49d478af19b9cdab4780fb8a708a3c90d4c3eac5d36d6', 'e3d6dee88e0da6f801877138d4b8ffba381729706001c1ef50cd634ef942269e'],
];
function mutate(code, before, after) {
  assert.ok(code.includes(before), `Mutation anchor missing: ${mutation}`);
  return code.replace(before, after);
}
function loadNormalizer(uncapped) {
  let code = readFileSync(new URL('../src/lib/services/clipInsightService.js', import.meta.url), 'utf8');
  if (mutation === 'lead-main') code = mutate(code, 'p.topicsV2?.schemaVersion === 2 ? [] :', 'false ? [] :');
  if (mutation === 'lead-sub') code = mutate(code, '.filter((story) => !story.storyId)', '');
  if (mutation === 'lead-legacy') code = mutate(code, '.filter((story) => !story.storyId)', '.filter(() => false)');
  const out = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandboxModule = { exports: {} };
  const localRequire = (spec) => {
    if (spec === '@/lib/services/clipAI/openai') return { callAI() { throw new Error('Unexpected paid AI call'); } };
    if (spec === '@/lib/ai/modelConfig') return { MODEL_FAST: 'test-disabled', MODEL_NEWS_ANALYSIS: 'test-disabled' };
    throw new Error('Unexpected normalizer dependency: ' + spec);
  };
  new Function('require', 'module', 'exports', 'process', out)(localRequire, sandboxModule, sandboxModule.exports, { env: { CLIP_UNCAPPED: uncapped ? '1' : '0' } });
  return sandboxModule.exports;
}
const normalizers = [loadNormalizer(false), loadNormalizer(true)];
const { normalizeInsight, assessClipDirectLead } = normalizers[1];
const cache = new Map();
function loadUI(name, override) {
  if (!override && cache.has(name)) return cache.get(name);
  let code = override || source(name);
  if (mutation === 'chip-quotes' && name === 'TopicCard.js') code = mutate(code, "if (issue.code === 'quote-unverified') continue;", '');
  if (mutation === 'overlap-siblings' && name === 'InsightCard.js' && !override) code = mutate(code, 'siblings={ins.topicsV2.stories}', '');
  if (mutation === 'band' && name === 'TopicCard.js') code = code.replace('n >= 100', 'n >= 99');
  if (mutation === 'severity' && name === 'BrainBox.js') code = code.replace("if (f?.side === 'ความพร้อม' || s === 'ข้อสังเกต') continue;", "if (f?.side === 'ความพร้อม' || s === 'ข้อสังเกต') { c.total += 1; continue; }");
  const out = ts.transpileModule(code, { compilerOptions: {
    jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const localRequire = (spec) => {
    if (spec === 'react') return React;
    if (spec === './statusMeta') return status;
    if (spec === '@/lib/services/clipNewsReadyText') return copy;
    if (spec === '@/lib/services/clipBrain/topicMetrics') return metrics;
    if (spec === './TopicCard' || spec === './BrainBox') return loadUI(spec.slice(2) + '.js');
    throw new Error('Unexpected UI dependency: ' + spec);
  };
  const sandboxModule = { exports: {} };
  new Function('require', 'module', 'exports', 'React', out)(localRequire, sandboxModule, sandboxModule.exports, React);
  if (!override) cache.set(name, sandboxModule.exports);
  return sandboxModule.exports;
}
const { default: TopicCard, TopicChip, topicChips, issueLabel, wordBand } = loadUI('TopicCard.js');
const { default: InsightCard } = loadUI('InsightCard.js');
const { default: BrainBox } = loadUI('BrainBox.js');
const body = (n) => Array(n).fill('ข่าว').join(' ');
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
const composePath = fileURLToPath(new URL('mae-phen-compose.json', FIXTURES));
const ids = ['046cde94-7185-474d-8438-5cc07bf3232b', '1ee5287f-3efb-4b3a-a61d-801bc5f0fb16', '950d07c0-5183-47f2-9055-963fad766fef'];
const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
const composed = JSON.parse(readFileSync(composePath, 'utf8'));
const maePhenArchive = archive.find((r) => r.id === ids[2]);
const maePhen = await createFixtureRecord(composed, maePhenArchive, {
  from: composePath, createdAt: maePhenArchive.createdAt,
});
assert.equal(maePhen?.insight?.topicsV2?.schemaVersion, 2, 'Real P5 Mae Phen fixture is required');
for (const id of ids) test(`legacy real archive ${id}: copy bytes and InsightCard markup unchanged`, () => {
  const rec = archive.find((r) => r.id === id);
  assert.ok(rec?.insight, 'Real archived record is required, no skip or synthetic fallback');
  assert.equal(rec.insight.topicsV2, undefined);
  assert.deepEqual(Buffer.from(copy.buildClipNewsReadyText(rec.insight)), Buffer.from(legacyCopy.buildClipNewsReadyText(rec.insight)));
  for (const [i, s] of (rec.insight.subStories || []).entries()) {
    assert.deepEqual(Buffer.from(copy.buildClipSubStoryText(s, i)), Buffer.from(legacyCopy.buildClipSubStoryText(s, i)));
  }
  const OldCard = loadUI('InsightCard.js', unpack(BASE_CARD)).default;
  for (const live of [false, true]) {
    assert.equal(renderToStaticMarkup(React.createElement(InsightCard, { rec, live })),
      renderToStaticMarkup(React.createElement(OldCard, { rec, live })));
  }
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

test('word chips warn only below the 100-word floor (no ceiling) using Thai segmentation', () => {
  for (const [n, tone] of [[99, 'warn'], [100, 'ok'], [170, 'ok'], [171, 'ok']]) {
    assert.equal(wordBand(n), tone);
    assert.equal(metrics.countThaiWords(body(n)), n);
    assert.deepEqual(topicChips(story({ story: body(n) }))[0], { label: `${n} คำ`, tone, title: 'กรอบเนื้อพร้อมใช้ อย่างน้อย 100 คำ' });
  }
});
test('every issue code has a human label and detail; relationship/count chips preserve zero', () => {
  const codes = ['length-short', 'length-long', 'no-highlight', 'bureaucratic', 'long-sentence', 'overlap', 'quote-unverified', 'quote-short', 'no-facts', 'missing', 'main-story-stale'];
  for (const code of codes) { assert.ok(issueLabel(code).length); assert.notEqual(issueLabel(code), code); assert.notEqual(issueLabel(code), 'ข้อสังเกตเพิ่มเติม'); }
  const chips = topicChips(story({ sharePct: 0, standalone: false, overlaps: [{ storyId: 's9', kind: 'shared_context' }], quality: { status: 'checked', issues: codes.map((code) => ({ code, detail: `รายละเอียด ${code}` })) } }));
  for (const code of codes.filter((c) => c !== 'quote-unverified')) {
    const label = code === 'quote-short' ? 'คำพูดสั้น 1' : issueLabel(code);
    assert.ok(chips.some((c) => c.label === label && c.title === `รายละเอียด ${code}` && c.tone === 'warn'));
  }
  assert.ok(!chips.some((c) => c.label === issueLabel('quote-unverified')));
  for (const label of ['กินเวลา 0%', 'ข้อเท็จจริง 1', 'คำพูดยืนยัน 2/4', 'ต้องอ่านคู่เรื่องอื่น', 'บริบทร่วมกับ s9']) assert.ok(chips.some((c) => c.label === label), label);
  assert.ok(!topicChips(story({ sharePct: null })).some((c) => c.label.startsWith('กินเวลา')));
  assert.ok(topicChips(story({ quality: { status: 'not_checked', issues: [] } })).some((c) => c.label === 'ยังไม่ตรวจความพร้อม'));
});
test('quote chips aggregate real Mae Phen quotes and repeated issue codes with accurate tones', () => {
  for (const s of maePhen.insight.topicsV2.stories) {
    const chips = topicChips(s);
    assert.deepEqual(chips.filter((c) => c.label.startsWith('คำพูด')).map(({ label, tone }) => ({ label, tone })),
      [{ label: `คำพูดยืนยัน 0/${s.quotes.length}`, tone: 'warn' }]);
    const html = renderToStaticMarkup(React.createElement(TopicCard, { story: s }));
    assert.equal((html.match(/>คำพูดยืนยัน /g) || []).length, 1);
    assert.doesNotMatch(html, /คำพูดยังไม่ยืนยัน/);
  }
  for (const [quotes, label, tone] of [
    [[], 'ไม่มีคำพูด', 'info'],
    [[{ verification: 'verified' }], 'คำพูดยืนยัน 1/1', 'ok'],
    [[{ verification: 'verified' }, { verification: 'verified' }], 'คำพูดยืนยัน 2/2', 'ok'],
    [story().quotes, 'คำพูดยืนยัน 2/4', 'warn'],
    [[{ verification: 'pending' }, {}], 'คำพูดยืนยัน 0/2', 'warn'],
  ]) {
    const chips = topicChips(story({ quotes })).filter((c) => /^(คำพูด|ไม่มีคำพูด)/.test(c.label));
    assert.equal(chips.length, 1);
    assert.equal(chips[0].label, label); assert.equal(chips[0].tone, tone);
  }
  const input = story({ quality: { status: 'checked', issues: [
    { code: 'quote-short', detail: 'สั้นหนึ่ง' }, { code: 'long-sentence', detail: 'ยาวหนึ่ง' },
    { code: 'quote-short', detail: 'สั้นสอง' }, { code: 'long-sentence', detail: 'ยาวสอง' },
    { code: 'no-facts' }, { code: 'quote-unverified', detail: 'ไม่ยืนยันหนึ่ง' },
    { code: 'quote-unverified', detail: 'ไม่ยืนยันสอง' },
  ] } });
  const before = structuredClone(input);
  const chips = topicChips(input);
  assert.deepEqual(chips.filter((c) => c.label.startsWith('คำพูดสั้น')), [{ label: 'คำพูดสั้น 2', tone: 'warn', title: 'สั้นหนึ่ง\nสั้นสอง' }]);
  assert.deepEqual(chips.filter((c) => c.label.startsWith('ประโยคยาว')), [{ label: 'ประโยคยาว 2', tone: 'warn', title: 'ยาวหนึ่ง\nยาวสอง' }]);
  assert.deepEqual(chips.filter((c) => c.label === 'ยังไม่มีข้อเท็จจริง'), [{ label: 'ยังไม่มีข้อเท็จจริง', tone: 'warn', title: 'ยังไม่มีข้อเท็จจริง' }]);
  assert.ok(!chips.some((c) => c.label === 'คำพูดยังไม่ยืนยัน'));
  assert.deepEqual(input, before);
});

test('overlap chips resolve Thai kinds and sibling titles with a 24-character limit and ID fallback', () => {
  const siblings = [story({ id: 'target', topic: 'หัวเรื่องสั้น' }), story({ id: 'long', topic: 'ก'.repeat(25) }), story({ id: 'edge', topic: 'ข'.repeat(24) })];
  const before = structuredClone(siblings);
  for (const [kind, thai] of [['duplicate', 'ซ้ำกับ'], ['shared_context', 'บริบทร่วมกับ'], ['follow_up', 'ต่อเนื่องจาก']]) {
    for (const [id, expected] of [['target', 'หัวเรื่องสั้น'], ['long', 'ก'.repeat(24)], ['edge', 'ข'.repeat(24)], ['missing-id', 'missing-id']]) {
      const input = story({ overlaps: [{ storyId: id, kind }] });
      const chip = topicChips(input, siblings).at(-1);
      assert.equal(chip.label, `${thai} ${expected}`);
      assert.equal(chip.title, `${thai} ${siblings.find((s) => s.id === id)?.topic || id}`);
      const tree = renderer(TopicCard, { story: input, siblings })();
      assert.equal(nodes(tree, (e) => e.type === TopicChip).at(-1).props.label, chip.label);
    }
  }
  assert.equal(topicChips(story({ overlaps: [{ storyId: 'target', kind: 'duplicate' }] })).at(-1).label, 'ซ้ำกับ target');
  assert.deepEqual(siblings, before);
});

test('InsightCard overlap wiring passes every sibling and renders real fixture relationship titles', () => {
  const tree = renderer(InsightCard, { rec: maePhen })();
  const siblings = maePhen.insight.topicsV2.stories;
  const cards = nodes(tree, (e) => e.type === TopicCard);
  assert.equal(cards.length, siblings.length);
  for (const card of cards) assert.equal(card.props.siblings, siblings);
  const html = renderToStaticMarkup(React.createElement(InsightCard, { rec: maePhen }));
  for (const s of siblings) assert.ok(html.includes(`>ต่อเนื่องจาก ${[...s.topic].slice(0, 24).join('')}</span>`));
  assert.doesNotMatch(html, /follow_up|shared_context|เกี่ยวข้องกับ s[12]/);
});

test('v2 normalization skips directLead checks for both the real fixture stories and whole clip', () => {
  const before = structuredClone(maePhen);
  const input = { ...maePhen.insight, directLead: maePhen.insight.subStories[0].directLead };
  assert.ok(assessClipDirectLead(input).length, 'Whole clip must fail the old directLead check');
  for (const s of input.subStories) assert.ok(assessClipDirectLead(s).length, 'Every highlight must exercise the old mismatch');
  for (const normalizer of normalizers) {
    const actual = normalizer.normalizeInsight(input, input.engine);
    assert.deepEqual(actual.editorialWarnings, []);
    assert.deepEqual(actual.topicsV2, input.topicsV2);
    assert.equal(actual.subStories.length, input.subStories.length);
    for (const [i, s] of actual.subStories.entries()) {
      assert.equal(s.rawData, input.subStories[i].rawData);
      assert.equal(s.directLead, input.subStories[i].directLead);
    }
  }
  const normalized = normalizeInsight(maePhen.insight, maePhen.insight.engine);
  assert.deepEqual(normalized.editorialWarnings, []);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(InsightCard, { rec: { ...maePhen, insight: normalized } })), /จุดให้พนักงานตรวจประโยคเปิด|เนื้อดิบไม่ได้เริ่มด้วย directLead/);
  assert.deepEqual(maePhen, before);
});

test('legacy normalization preserves real archive output bytes in capped and uncapped modes and retains warnings', () => {
  for (const [i, id] of ids.entries()) {
    const rec = archive.find((r) => r.id === id);
    assert.ok(rec?.insight); assert.equal(rec.insight.topicsV2, undefined);
    const before = structuredClone(rec.insight);
    for (const [mode, normalizer] of normalizers.entries()) {
      const actual = normalizer.normalizeInsight(rec.insight, 'clip-brain');
      assert.equal(createHash('sha256').update(JSON.stringify(actual)).digest('hex'), BASE_NORMALIZED[i][mode], `${id}, uncapped=${mode}`);
      if (i === 1) assert.ok(actual.editorialWarnings.includes('ประเด็น 8: เนื้อดิบไม่ได้เริ่มด้วย directLead ตามที่โมเดลส่งมา'));
      if (i === 2) assert.ok(actual.editorialWarnings.some((w) => w.includes('ไม่มีประโยคเปิด directLead')));
    }
    assert.deepEqual(rec.insight, before);
  }
});

test('normalization guards are independent: storyId skips substory only; schemaVersion 2 skips whole clip only', () => {
  const input = { ...maePhen.insight, directLead: maePhen.insight.subStories[0].directLead };
  const wholeWarnings = assessClipDirectLead(input);
  assert.ok(wholeWarnings.length);
  for (const topicsV2 of [undefined, { schemaVersion: 1 }, { schemaVersion: '2' }]) {
    assert.deepEqual(normalizeInsight({ ...input, topicsV2 }, 'clip-brain').editorialWarnings, wholeWarnings);
  }
  const subStories = input.subStories.map(({ storyId: _storyId, ...s }) => s);
  const expected = subStories.flatMap((s, i) => assessClipDirectLead({ ...s, label: `ประเด็น ${i + 1}` }));
  assert.ok(expected.length);
  assert.deepEqual(normalizeInsight({ ...input, subStories }, 'clip-brain').editorialWarnings, expected);
  const emptyIds = subStories.map((s) => ({ ...s, storyId: '' }));
  assert.deepEqual(normalizeInsight({ ...input, subStories: emptyIds }, 'clip-brain').editorialWarnings, expected);
});

test('TopicCard real buttons copy key/text, highlight separately and toggle closed body', () => {
  const calls = [];
  const render = renderer(TopicCard, { story: story(), isMain: true, copyKey: 'topic-s1', copy: (...args) => calls.push(args) });
  let tree = render();
  assert.match(text(tree), /★ หัวเรื่องแสดงแยก/);
  assert.doesNotMatch(text(tree), /เนื้อประโยคแรก|ยังตรวจไม่ผ่าน/);
  const buttons = nodes(tree, (e) => e.type === 'button');
  buttons[0].props.onClick(); buttons[1].props.onClick(); buttons[2].props.onClick();
  assert.deepEqual(calls, [['topic-s1-ready', readyExpected], ['topic-s1-highlight', story().highlight]]);
  tree = render();
  assert.match(text(tree), /เนื้อประโยคแรก/);
  assert.match(text(tree), /✓ ยืนยันแล้ว/); assert.match(text(tree), /⚠ ยังไม่ยืนยัน/); assert.match(text(tree), /ข้อเท็จจริงหนึ่ง/);
  assert.equal(nodes(tree, (e) => e.type === 'button')[2].props['aria-expanded'], true);
  nodes(tree, (e) => e.type === 'button')[2].props.onClick();
  assert.doesNotMatch(text(render()), /เนื้อประโยคแรก/);
});
test('InsightCard v2 sorts main first then share, copies main and folds exact legacy JSX', () => {
  const stories = [story({ id: 'low', sharePct: 10 }), story({ id: 'high', sharePct: 80 }), story({ id: 'main', sharePct: 0 })];
  const rec = { id: 'v2-case', insight: { mainStory: 'เรื่องหลัก\nทั้งคลิป', rawData: 'RAW_LEGACY', subStories: [{ topic: 'old', rawData: 'OLD_SUB' }], topicsV2: { schemaVersion: 2, mainTopicId: 'main', mainStoryStale: true, stories, mainStoryQuality: { status: 'checked', issues: [] } } } };
  const calls = [];
  const tree = renderer(InsightCard, { rec, onCopy: (...args) => calls.push(args) })();
  const cards = nodes(tree, (e) => e.type === TopicCard);
  assert.deepEqual(cards.map((c) => c.props.story.id), ['main', 'high', 'low']);
  assert.deepEqual(stories.map((s) => s.id), ['low', 'high', 'main']);
  nodes(tree, (e) => e.type === 'button' && text(e) === 'คัดลอกเรื่องหลัก')[0].props.onClick();
  assert.deepEqual(calls[0], ['ic-v2-case-main-v2', copy.buildClipNewsReadyText(rec.insight)]);
  const html = renderToStaticMarkup(React.createElement(InsightCard, { rec }));
  assert.match(html, /เรื่องหลักต้องทบทวน/);
  assert.match(html, /<details[^>]*><summary[^>]*>ของเดิม \/ เนื้อเต็ม<\/summary>[\s\S]*RAW_LEGACY[\s\S]*OLD_SUB[\s\S]*<\/details>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|>)/);
  assert.ok(html.indexOf('เรื่องหลักทั้งคลิป') < html.indexOf('data-topic-id'));
  assert.ok(source('InsightCard.js').includes('<TopicCard'));
  assert.ok(source('InsightCard.js').includes('ins.topicsV2?.schemaVersion === 2'));
  const original = unpack(BASE_CARD);
  const legacyBlock = original.slice(original.indexOf('      {/* ── ป้ายชนิดคลิป'), original.lastIndexOf('    </div>'));
  assert.ok(source('InsightCard.js').includes(legacyBlock), 'Original legacy JSX is byte-for-byte present');
});
test('BrainBox severity never counts readiness observations, including misplaced input', () => {
  const brain = { status: 'สะอาด', check: { code: { findings: [{ severity: 'ข้อสังเกต', detail: 'readiness note' }, { severity: 'สูง', side: 'ความพร้อม', detail: 'wrong severity' }, { severity: 'ต่ำ', side: 'ความจริง', detail: 'short' }] }, ai: { findings: [{ severity: 'กลาง', side: 'ความจริง', detail: 'truth' }] }, lowCount: 1,
    readiness: { findings: [{ severity: 'ข้อสังเกต', detail: 'too short' }], counts: { stories: 2, withIssues: 1, byCode: { 'length-short': 1 } } } } };
  const html = renderToStaticMarkup(React.createElement(BrainBox, { brain }));
  assert.match(html, /รวม 2 จุด/); assert.doesNotMatch(html, /สูง 1|รวม 4 จุด/);
  assert.match(html, /คำพูดสั้นตรวจไม่ได้ 1/); assert.match(html, /ความจริง/); assert.match(html, /ความพร้อม/);
  assert.match(html, /ตรวจ 2 เรื่อง/); assert.match(html, /มีข้อสังเกต 1 เรื่อง/); assert.match(html, /สั้นเกินกรอบ 1/);
  assert.match(source('BrainBox.js'), /s === 'ข้อสังเกต'\) continue/);
});
test('BrainBox v2 summary handles success, failed attempts, missing costs and degradation reasons', () => {
  const brain = { topicsV2: { ok: true, gate: { pass: true }, stories: [{}, {}], attempts: [{ brain: 'codex', model: 'model-fixture', effort: 'ultra', elapsedMs: 1000, costUSD: 0.12 }] } };
  let html = renderToStaticMarkup(React.createElement(BrainBox, { brain }));
  assert.match(html, /ประเด็น v2: 2 เรื่อง · ผ่านด่าน/); assert.match(html, /codex \/ model-fixture \(ultra\)/); assert.match(html, /\$0\.1200/);
  for (const type of ['topics-v2-failed', 'topics-v2-crashed', 'topics-v2-skipped-no-truth', 'readiness-crashed']) {
    html = renderToStaticMarkup(React.createElement(BrainBox, { brain: { topicsV2: { ok: false, reason: 'composer unavailable', attempts: [] }, degradations: [{ type, why: 'synthetic reason' }] } }));
    assert.match(html, /ไม่ผ่าน/); assert.match(html, /synthetic reason/); assert.match(html, /ไม่มีข้อมูลค่าใช้จ่าย/);
  }
});
test('fixture dry-run and write adapt committed v2 data in a temporary store; refuse output escapes', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clip-topic-v2-'));
  try {
    const output = path.join(tempRoot, 'fixture.json');
    const roots = { labRoot: fileURLToPath(new URL('../', import.meta.url)), outputRoot: tempRoot };
    const inputsBefore = [readFileSync(composePath), readFileSync(archivePath)];
    const args = ['--from', composePath, '--archive', archivePath, '--out', output];
    assert.equal(existsSync(output), false);
    const result = await runFixture([...args, '--dry-run'], roots);
    assert.equal(result.stories, 2); assert.equal(result.dryRun, true); assert.match(result.note, /rawData/);
    assert.equal(existsSync(output), false);
    const outside = path.join(tempRoot, '..', path.basename(tempRoot) + '-forbidden.json');
    await assert.rejects(() => runFixture(args.map((v) => v === output ? outside : v), roots), /inside lab/);
    assert.equal(existsSync(outside), false);
    const written = await runFixture(args, roots);
    assert.equal(written.dryRun, false); assert.equal(written.records, 1);
    const rows = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(rows.length, 1); assert.equal(rows[0].id, maePhen.id);
    assert.deepEqual(rows[0].insight, JSON.parse(JSON.stringify(maePhen.insight)));
    assert.equal((await runFixture(args, roots)).records, 1, 'Repeated runs replace the fixture without duplicates');
    assert.deepEqual([readFileSync(composePath), readFileSync(archivePath)], inputsBefore);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

for (const [name, pattern] of [
  ['quotes', '^v2 verified copy'], ['band', '^word chips'], ['severity', '^BrainBox severity'],
  ['chip-quotes', '^quote chips aggregate'], ['overlap-siblings', '^InsightCard overlap wiring'],
  ['lead-main', '^v2 normalization skips'], ['lead-sub', '^v2 normalization skips'],
  ['lead-legacy', '^legacy normalization preserves'],
]) {
  test(`mutation ${name}: actual behavioral assertion rejects defective source`, () => {
    const env = { ...process.env, CLIP_TOPIC_UI_MUTATION: name };
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, fileURLToPath(import.meta.url)], {
      encoding: 'utf8', timeout: 60000, env,
    });
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stdout + child.stderr, /AssertionError|ERR_ASSERTION/);
    console.log(`MUTATION ${name}\n${(child.stdout + child.stderr).slice(-2500)}`);
  });
}
