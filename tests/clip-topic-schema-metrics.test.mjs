import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TOPIC_SCHEMA_VERSION, emptyTopicDoc, validateTopicDoc, computeSharePct, toLegacyInsight, fromLegacyInsight } from '../src/lib/services/clipBrain/topicSchema.js';
import { BUREAUCRATIC_WORDS, countThaiWords, lengthBand, bureaucraticRate, longSentenceCount, crossStoryOverlap, scoreTopicDoc } from '../src/lib/services/clipBrain/topicMetrics.js';
import { buildBaseline } from '../scripts/clip-topic-baseline.mjs';
import { buildClipSubStoryText, buildClipNewsReadyText } from '../src/lib/services/clipNewsReadyText.js';

const story = (id = 's1', overrides = {}) => ({
  id, topic: 'หลักสูตรครูสมาธิ', timeRanges: [{ startSec: 66, endSec: 157 }], sharePct: null,
  highlight: 'เปิดให้เรียนหกเดือน', story: 'ผู้สนใจเข้ารับการฝึกอบรมตามสาขาได้',
  facts: [{ id: `${id}-f1`, text: 'เรียนหกเดือน', kind: 'speaker_statement', evidenceIds: ['e1'] }],
  quotes: [{ text: 'มาเรียนเป็นครู', speaker: 'ผู้สอน', evidenceIds: ['e1'], verification: 'pending' }],
  standalone: true, overlaps: [], quality: { status: 'not_checked', issues: [] }, ...overrides,
});
const fixture = () => ({ ...emptyTopicDoc(), mainTopicId: 's1', mainStory: 'เรื่องหลัก', stories: [story()], evidence: [{ id: 'e1', sourceType: 'speech', text: 'เรียนหกเดือน' }] });
const sharedSentence = 'ชาวบ้านในพื้นที่ร่วมกันเปิดศูนย์ช่วยเหลือผู้ประสบภัยเพื่อให้ทุกครอบครัวมีอาหารและน้ำสะอาดเพียงพอ';
const hasPath = (result, path) => result.errors.some((e) => e.path === path && typeof e.msg === 'string');
const freezeDeep = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
};

 test('empty document and complete fixture validate; empty arrays are independently owned', () => {
  assert.equal(TOPIC_SCHEMA_VERSION, 2);
  assert.deepEqual(emptyTopicDoc(), { schemaVersion: 2, mainTopicId: null, mainStory: '', stories: [], evidence: [], identityLeads: [] });
  const a = emptyTopicDoc(); a.stories.push(story());
  assert.equal(emptyTopicDoc().stories.length, 0);
  assert.deepEqual(validateTopicDoc(emptyTopicDoc()), { ok: true, errors: [] });
  assert.deepEqual(validateTopicDoc(freezeDeep(fixture())), { ok: true, errors: [] });
});

function assertMissingEvidenceRejected(validate) {
  const doc = fixture(); doc.stories[0].facts[0].evidenceIds = ['missing'];
  const result = validate(doc);
  assert.equal(result.ok, false);
  assert.ok(hasPath(result, 'stories[0].facts[0].evidenceIds[0]'));
}

test('dangling fact and quote evidence references report exact paths', () => {
  assertMissingEvidenceRejected(validateTopicDoc);
  const doc = fixture(); doc.stories[0].quotes[0].evidenceIds.push('missing');
  assert.ok(hasPath(validateTopicDoc(doc), 'stories[0].quotes[0].evidenceIds[1]'));
});

test('main topic, duplicate IDs, overlap destinations and time ranges are checked', () => {
  const cases = [
    [(d) => { d.mainTopicId = 'missing'; }, 'mainTopicId'],
    [(d) => { d.mainTopicId = null; }, 'mainTopicId'],
    [(d) => { d.stories.push(story()); }, 'stories[1].id'],
    [(d) => { d.evidence.push({ id: 'e1' }); }, 'evidence[1].id'],
    [(d) => { d.stories[0].facts.push({ ...d.stories[0].facts[0] }); }, 'stories[0].facts[1].id'],
    [(d) => { d.stories[0].overlaps = [{ storyId: 'missing', kind: 'duplicate' }]; }, 'stories[0].overlaps[0].storyId'],
    [(d) => { d.stories[0].overlaps = [{ storyId: 's1', kind: 'duplicate' }]; }, 'stories[0].overlaps[0].storyId'],
    [(d) => { d.stories[0].timeRanges = [{ startSec: 5, endSec: 5 }]; }, 'stories[0].timeRanges[0]'],
    [(d) => { d.stories[0].timeRanges = [{ startSec: -1, endSec: 5 }]; }, 'stories[0].timeRanges[0]'],
    [(d) => { d.stories[0].timeRanges = [{ startSec: 0, endSec: Infinity }]; }, 'stories[0].timeRanges[0]'],
    [(d) => { d.stories[0].sharePct = '30'; }, 'stories[0].sharePct'],
    [(d) => { d.stories[0].facts[0].kind = 'guess'; }, 'stories[0].facts[0].kind'],
    [(d) => { d.stories[0].quotes[0].verification = 'pending_audio_check'; }, 'stories[0].quotes[0].verification'],
    [(d) => { d.stories[0].quality.status = 'approved'; }, 'stories[0].quality.status'],
  ];
  for (const [change, path] of cases) {
    const doc = fixture(); change(doc);
    assert.ok(hasPath(validateTopicDoc(doc), path), path);
  }
  const good = fixture(); good.stories.push(story('s2'));
  good.stories[0].overlaps = [{ storyId: 's2', kind: 'shared_context' }];
  assert.equal(validateTopicDoc(good).ok, true);
});

test('malformed documents return errors instead of crashing', () => {
  for (const doc of [null, undefined, [], 1, {}, { schemaVersion: 2, stories: [null, {}], evidence: [null], identityLeads: [null] }]) {
    const result = validateTopicDoc(doc);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length);
  }
});

test('unverified identity strings/names/aliases cannot enter topic, highlight, story or mainStory', () => {
  for (const field of ['topic', 'highlight', 'story', 'mainStory']) {
    const doc = fixture(); doc.identityLeads = [{ name: 'สมชาย ใจดี', aliases: ['ชื่อเล่นลับ'] }];
    if (field === 'mainStory') doc.mainStory = 'สมชาย ใจดี เปิดเผยรายละเอียด';
    else doc.stories[0][field] = 'สมชาย\u200b  ใจดี เปิดเผยรายละเอียด';
    assert.ok(hasPath(validateTopicDoc(doc), field === 'mainStory' ? field : `stories[0].${field}`));
  }
  const doc = fixture(); doc.identityLeads = ['ชื่อที่ยังไม่ยืนยัน'];
  assert.equal(validateTopicDoc(doc).ok, true);
  doc.stories[0].story += ' ชื่อที่ยังไม่ยืนยัน';
  assert.equal(validateTopicDoc(doc).ok, false);
  doc.identityLeads = [{ name: 'บุคคลอื่น', aliases: ['ชื่อที่ยังไม่ยืนยัน'] }];
  assert.equal(validateTopicDoc(doc).ok, false);
});

test('time shares merge overlaps/duplicates, clip bounds and preserve inputs', () => {
  const doc = fixture(); doc.stories[0].timeRanges = [
    { startSec: 20, endSec: 60 }, { startSec: 0, endSec: 30 },
    { startSec: 20, endSec: 60 }, { startSec: 90, endSec: 120 },
  ];
  doc.stories.push(story('s2', { timeRanges: [{ startSec: 0, endSec: 100 }] }));
  const result = computeSharePct(freezeDeep(doc), 100);
  assert.equal(result.stories[0].sharePct, 70);
  assert.equal(result.stories[1].sharePct, 100);
  assert.equal(doc.stories[0].sharePct, null);
  result.stories[0].facts[0].text = 'changed';
  assert.equal(doc.stories[0].facts[0].text, 'เรียนหกเดือน');
  for (const duration of [undefined, null, 0, -1, NaN, Infinity, '100']) {
    assert.ok(computeSharePct(doc, duration).stories.every((s) => s.sharePct === null));
  }
  assert.equal(computeSharePct({ stories: [story('s1', { timeRanges: [] })] }, 100).stories[0].sharePct, null);
  assert.equal(computeSharePct({ stories: [story('s1', { timeRanges: [{ startSec: 110, endSec: 120 }] })] }, 100).stories[0].sharePct, 0);
});

test('legacy projection retains raw archive/envelope and string quotes, with detached copies', () => {
  const doc = fixture(); doc.stories[0].timeRanges.push({ startSec: 200, endSec: 250 });
  const base = { headline: 'พาดหัวเดิม', rawData: 'เนื้อเต็ม  '.repeat(500), overview: 'ภาพรวมเดิม', quotes: ['คำพูดเดิม'], keyPoints: [{ point: 'เดิม' }], timeline: [], speakers: ['ผู้สอน'], category: 'การศึกษา', clipType: 'interview', directLead: 'เปิดเดิม', custom: { retained: true } };
  const result = toLegacyInsight(freezeDeep(doc), freezeDeep(base));
  assert.equal(result.rawData, base.rawData);
  assert.equal(result.headline, base.headline);
  assert.equal(result.directLead, base.directLead);
  assert.deepEqual(result.quotes, ['คำพูดเดิม']);
  assert.deepEqual(result.keyPoints, base.keyPoints);
  assert.equal(result.subStories[0].rawData, doc.stories[0].story);
  assert.deepEqual(result.subStories[0].quotes, ['มาเรียนเป็นครู']);
  assert.equal(result.subStories[0].directLead, doc.stories[0].highlight);
  assert.equal(result.subStories[0].timeRange, '1:06–2:37, 3:20–4:10');
  assert.deepEqual(result.topicsV2, doc);
  assert.equal(result.mainStory, doc.mainStory);
  result.topicsV2.stories[0].story = 'changed'; result.custom.retained = false;
  assert.notEqual(result.topicsV2.stories[0].story, doc.stories[0].story);
  assert.equal(base.custom.retained, true);
  const fallback = toLegacyInsight(doc, { quotes: [{ text: 'ข้อความ' }, { quote: 'อีกคำ' }] });
  assert.equal(fallback.headline, doc.stories[0].topic);
  assert.deepEqual(fallback.quotes, ['ข้อความ', 'อีกคำ']);
});

test('legacy migration round trip preserves content, marks quotes pending and invents no evidence', () => {
  const input = { headline: 'เดิม', rawData: 'ต้นฉบับรวม', quotes: ['รวม'], subStories: [{ topic: 'เรื่องหนึ่ง', timeRange: '01:06-02:37, 3:20—4:10', directLead: 'ไฮไลท์', rawData: 'เนื้อของเรื่องหนึ่ง', quotes: ['คำพูด'], keyPoints: ['ข้อมูล'] }] };
  const doc = fromLegacyInsight(freezeDeep(input));
  assert.equal(validateTopicDoc(doc).ok, true);
  assert.deepEqual(doc.evidence, []);
  assert.equal(doc.mainStory, '');
  assert.equal(doc.stories[0].quotes[0].verification, 'pending');
  const result = toLegacyInsight(doc, input);
  for (const field of ['topic', 'directLead', 'rawData', 'quotes', 'keyPoints']) assert.deepEqual(result.subStories[0][field], input.subStories[0][field], field);
  assert.equal(result.rawData, input.rawData);
  assert.deepEqual(fromLegacyInsight(result), doc);
});

test('legacy migration handles absent/empty stories, unknown time labels and stable distinct IDs', () => {
  assert.deepEqual(fromLegacyInsight(null), emptyTopicDoc());
  assert.deepEqual(fromLegacyInsight({ rawData: 'ข่าวเดียว' }), emptyTopicDoc());
  const doc = fromLegacyInsight({ subStories: [null, { storyId: 's1', timeRange: 'ช่วงต้น' }, { storyId: 's1', timeRange: '1:70-2:20' }, { timeRange: '1:00:00–1:01:00' }] });
  assert.equal(doc.stories.length, 4);
  assert.equal(new Set(doc.stories.map((s) => s.id)).size, 4);
  assert.deepEqual(doc.stories[1].timeRanges, []);
  assert.deepEqual(doc.stories[2].timeRanges, []);
  assert.deepEqual(doc.stories[3].timeRanges, [{ startSec: 3600, endSec: 3660 }]);
  assert.equal(validateTopicDoc(doc).ok, true);
});

test('P5 news-ready uses mainStory while per-story copy keeps its own text and excludes unverified string quotes', () => {
  const doc = fixture(); doc.stories.push(story('s2', { story: 'เนื้อของเรื่องที่สอง', quotes: [] }));
  const result = toLegacyInsight(doc, { rawData: 'เนื้อรวมที่ต้องเก็บ', quotes: ['คำพูดเรื่องอื่น'] });
  assert.ok(buildClipSubStoryText(result.subStories[0]).includes(doc.stories[0].story));
  assert.equal(buildClipSubStoryText(result.subStories[1]), doc.stories[1].story);
  assert.ok(!buildClipSubStoryText(result.subStories[0]).includes(doc.stories[0].quotes[0].text));
  const text = buildClipNewsReadyText(result);
  assert.equal(text, doc.mainStory);
  assert.ok(!text.includes(doc.stories[0].story));
  assert.ok(!text.includes(doc.stories[1].story));
  assert.ok(!text.includes('[object Object]'));
  assert.ok(!text.includes('คำพูดเรื่องอื่น'));
});

test('Thai counting matches independent Intl segmentation on three real/mixed texts', () => {
  const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
  for (const text of ['หลักสูตรครูสมาธิใช้เวลาเรียนหกเดือน', 'ผู้สอนกล่าวว่า “มาเรียนเป็นครู” วันที่ 6 กันยายน 2569', 'ข่าว AI รุ่น v2 มี 100–170 คำ 😊\nNext.js พร้อมใช้']) {
    const expected = [...segmenter.segment(text)].filter((s) => s.isWordLike).length;
    assert.equal(countThaiWords(text), expected);
  }
  assert.equal(countThaiWords(''), 0);
  assert.equal(countThaiWords(' !? 😊\n'), 0);
  assert.equal(countThaiWords(null), 0);
});

function assertLengthBoundaries(band) {
  assert.deepEqual([99, 100, 170, 171].map(band), ['short', 'ok', 'ok', 'long']);
}
test('length band includes both 100 and 170', () => assertLengthBoundaries(lengthBand));

test('bureaucratic literal rate uses characters, counts repetitions and longest matches once', () => {
  assert.ok(BUREAUCRATIC_WORDS.length >= 20);
  const text = 'กรณีดังกล่าว ทั้งนี้ ทั้งนี้';
  assert.equal(bureaucraticRate(text), 3 / [...text].length * 1000);
  assert.equal(bureaucraticRate('ดังกล่าว'), 1000 / [...'ดังกล่าว'].length);
  assert.equal(bureaucraticRate('xx xx', { words: ['xx', 'x', 'xx'] }), 400);
  assert.equal(bureaucraticRate('a+b a+b', { words: ['a+b'] }), 2000 / 7);
  assert.equal(bureaucraticRate('', { words: [''] }), 0);
  assert.equal(bureaucraticRate('ทั้งนี้', { words: [] }), 0);
});

test('long sentence proxy splits punctuation and paragraphs while retaining word spaces and decimals', () => {
  const sixty = 'ข่าว '.repeat(60).trim();
  const sixtyOne = 'ข่าว '.repeat(61).trim();
  assert.equal(longSentenceCount(sixty), 0);
  assert.equal(longSentenceCount(sixtyOne), 1);
  assert.equal(longSentenceCount(`${sixtyOne}\n\n${sixty}. ${sixtyOne}!`), 2);
  assert.equal(longSentenceCount('ราคา 2.4 บาท', 2), 1);
});

function assertOverlapDetected(overlap) {
  const result = overlap([{ id: 'a', story: sharedSentence }, { id: 'b', story: `${sharedSentence}!` }]);
  assert.equal(result.pct, 50);
  assert.deepEqual(result.pairs, [{ a: 'a', b: 'b', sentence: sharedSentence }]);
}
test('cross-story duplicate detection normalizes whitespace/punctuation and excludes local repeats', () => {
  assertOverlapDetected(crossStoryOverlap);
  assert.equal(crossStoryOverlap([{ id: 'a', story: `${sharedSentence}\n${sharedSentence}` }]).pct, 0);
  const result = crossStoryOverlap([{ id: 'a', story: sharedSentence }, { id: 'b', story: sharedSentence.replace('พื้นที่', 'พื้นที่   ') }, { id: 'c', story: sharedSentence }]);
  assert.equal(result.pct, 2 / 3 * 100);
  assert.equal(result.pairs.length, 3);
  assert.deepEqual(crossStoryOverlap([]), { pct: 0, pairs: [] });
  assert.equal(crossStoryOverlap([{ story: 'สั้น' }, { story: 'สั้น' }]).pct, 0);
  assert.equal(crossStoryOverlap([{ story: sharedSentence }, { story: 'อีกเรื่องหนึ่งมีเนื้อหาต่างออกไปและไม่มีประโยคที่ตรงกับเรื่องก่อนหน้าเลยแม้แต่น้อย' }]).pct, 0);
});

test('scores are advisory, use resolved evidence links and leave long stories intact', () => {
  const doc = fixture(); doc.stories[0].story = 'ข่าว '.repeat(171);
  doc.stories[0].facts.push({ id: 's1-f2', text: 'ไม่มีหลักฐาน', kind: 'observed', evidenceIds: ['missing'] });
  const result = scoreTopicDoc(freezeDeep(doc));
  assert.equal(result.stories[0].words, 171);
  assert.equal(result.stories[0].band, 'long');
  assert.equal(result.stories[0].hasHighlight, true);
  assert.equal(result.stories[0].hasQuote, true);
  assert.equal(result.stories[0].factsWithEvidencePct, 50);
  assert.equal(result.summary.storiesInRangePct, 0);
  assert.equal(doc.stories[0].story, 'ข่าว '.repeat(171));
  const empty = scoreTopicDoc(emptyTopicDoc());
  assert.deepEqual(empty.summary, { storiesInRangePct: 0, overlapPct: 0, mainStoryWords: 0, mainStoryBand: 'short' });
});

test('baseline separates brain records, includes zero-story records, and never compares different clips', () => {
  const rows = [
    { id: 'a', insight: { brain: {}, rawData: 'ข่าว '.repeat(100), subStories: [{ rawData: sharedSentence }] } },
    { id: 'b', insight: { brain: true, rawData: 'ข่าว '.repeat(200), subStories: [{ rawData: sharedSentence }] } },
    { id: 'c', insight: { rawData: 'ข่าวเดียว' } },
    { id: 'invalid' },
  ];
  const report = buildBaseline(freezeDeep(rows));
  assert.equal(report.cohorts.brain.recordCount, 2);
  assert.equal(report.cohorts.brain.rawDataWordsMedian, 150);
  assert.equal(report.cohorts.brain.overlapPctMean, 0);
  assert.equal(report.cohorts.other.recordCount, 1);
  assert.equal(report.cohorts.other.recordsWithoutStories, 1);
  assert.deepEqual(report.skippedIndices, [3]);
});

test('baseline CLI refuses a report destination equal to its input before any write', () => {
  const script = fileURLToPath(new URL('../scripts/clip-topic-baseline.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, script, script], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to overwrite the source dataset/);
});

async function mutatedModule(file, before, after) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.ok(source.includes(before), 'Mutation must match an actual production guard');
  return import(`data:text/javascript;base64,${Buffer.from(source.replace(before, after)).toString('base64')}`);
}

test('mutation 1 is caught: disabling evidence reference checks fails the real validator assertion', async () => {
  const mutant = await mutatedModule('../src/lib/services/clipBrain/topicSchema.js', '!hasText(id) || !evidenceIds.has(id)', 'false');
  assert.throws(() => assertMissingEvidenceRejected(mutant.validateTopicDoc), { name: 'AssertionError' });
});

test('mutation 2 is caught: moving 100 into short fails the boundary assertion', async () => {
  const mutant = await mutatedModule('../src/lib/services/clipBrain/topicMetrics.js', 'words < 100', 'words <= 100');
  assert.throws(() => assertLengthBoundaries(mutant.lengthBand), { name: 'AssertionError' });
});

test('mutation 3 is caught: suppressing overlap percentage fails duplicate detection', async () => {
  const mutant = await mutatedModule('../src/lib/services/clipBrain/topicMetrics.js', 'pct: pct(repeated, total)', 'pct: 0');
  assert.throws(() => assertOverlapDetected(mutant.crossStoryOverlap), { name: 'AssertionError' });
});
