import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TOPIC_SCHEMA_VERSION, emptyTopicDoc, validateTopicDoc, computeSharePct, toLegacyInsight, fromLegacyInsight } from '../src/lib/services/clipBrain/topicSchema.js';
import { BUREAUCRATIC_WORDS, countThaiWords, lengthBand, bureaucraticRate, longSentenceCount, crossStoryOverlap, scoreTopicDoc, wordRange, wordRangeLabel, styleReport, styleIssues, STYLE_PAIR_PRONOUN_MAX } from '../src/lib/services/clipBrain/topicMetrics.js';
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
  assert.deepEqual([99, 100, 170, 171, 999].map(band), ['short', 'ok', 'ok', 'ok', 'ok']);
}
test('length band has a 100-word floor and no ceiling by default', () => assertLengthBoundaries(lengthBand));
test('length band ceiling comes back only through CLIP_TOPIC_WORDS_MAX and the floor through CLIP_TOPIC_WORDS_MIN', () => {
  const saved = [process.env.CLIP_TOPIC_WORDS_MAX, process.env.CLIP_TOPIC_WORDS_MIN];
  try {
    process.env.CLIP_TOPIC_WORDS_MAX = '170';
    assert.deepEqual([99, 100, 170, 171].map(lengthBand), ['short', 'ok', 'ok', 'long']);
    assert.equal(wordRangeLabel(), '100–170 คำ');
    process.env.CLIP_TOPIC_WORDS_MIN = '120';
    assert.deepEqual([119, 120].map(lengthBand), ['short', 'ok']);
    process.env.CLIP_TOPIC_WORDS_MAX = 'abc';
    assert.equal(wordRange().max, 0, 'garbage cap means no cap');
    assert.equal(wordRangeLabel(), 'อย่างน้อย 120 คำ');
  } finally {
    for (const [i, key] of ['CLIP_TOPIC_WORDS_MAX', 'CLIP_TOPIC_WORDS_MIN'].entries()) { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }
  }
});

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
  assert.equal(result.stories[0].band, 'ok', 'no ceiling: 171 words is in range');
  assert.equal(result.stories[0].hasHighlight, true);
  assert.equal(result.stories[0].hasQuote, true);
  assert.equal(result.stories[0].factsWithEvidencePct, 50);
  assert.equal(result.summary.storiesInRangePct, 100);
  assert.equal(doc.stories[0].story, 'ข่าว '.repeat(171));
  const empty = scoreTopicDoc(emptyTopicDoc());
  const { mainStoryStyle, ...rest } = empty.summary;
  assert.deepEqual(rest, { storiesInRangePct: 0, overlapPct: 0, mainStoryWords: 0, mainStoryBand: 'short' });
  assert.deepEqual([mainStoryStyle.words, mainStoryStyle.attribution, mainStoryStyle.longSentences], [0, 0, 0], 'empty main story has an empty style report');
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
  const mutant = await mutatedModule('../src/lib/services/clipBrain/topicMetrics.js', 'words < min', 'words <= min');
  assert.throws(() => assertLengthBoundaries(mutant.lengthBand), { name: 'AssertionError' });
});

test('mutation 3 is caught: suppressing overlap percentage fails duplicate detection', async () => {
  const mutant = await mutatedModule('../src/lib/services/clipBrain/topicMetrics.js', 'pct: pct(repeated, total)', 'pct: 0');
  assert.throws(() => assertOverlapDetected(mutant.crossStoryOverlap), { name: 'AssertionError' });
});

// ★ 9 ก.ย. 69 (Fable): ตัววัดสำนวน "ใจความล้วน"
test('styleReport counts attribution, dramatic, filler and meta terms with longest-match, plus long sentences', () => {
  const text = 'แม่เพ็ญเล่าว่าขายผักตั้งแต่ตีสี่\nลูกค้าถึงกับน้ำตาคลอเมื่อได้ยิน\nคลิปเริ่มจากภาพตลาด ทั้งนี้ราคาผักกลายเป็นข่าว\n' + Array.from({ length: 26 }, (_, i) => ['คน', 'รถ', 'บ้าน', 'น้ำ', 'งาน'][i % 5]).join(' ');
  const r = styleReport(text);
  assert.equal(r.attribution, 1, 'เล่าว่า');
  assert.deepEqual(r.matches.dramatic, ['ถึงกับ', 'น้ำตาคลอ']);
  assert.deepEqual(r.matches.filler, ['ทั้งนี้']);
  assert.deepEqual(r.matches.meta, ['คลิปเริ่มจาก']);
  assert.equal(r.longSentences, 1, 'the 26-word line is over the 25-word cap');
  assert.ok(r.fillerPer100 > 1, 'one filler in a short text still exceeds 1 per 100 words');
  const clean = styleReport('แม่เพ็ญขายผักตั้งแต่ตีสี่\nลูกค้าเงียบไปครู่หนึ่ง');
  assert.deepEqual([clean.attribution, clean.dramatic, clean.filler, clean.meta, clean.longSentences], [0, 0, 0, 0, 0]);
  assert.deepEqual(styleIssues(clean), []);
  const issues = styleIssues(r);
  assert.equal(issues.length, 5, 'one issue per category: ' + JSON.stringify(issues));
  assert.ok(issues[0].includes('เล่าว่า') && issues[1].includes('ถึงกับ') && issues[2].includes('คลิปเริ่มจาก') && issues[3].includes('25') && issues[4].includes('ทั้งนี้'));
  assert.deepEqual(styleIssues(r, { level: 'hard' }).length, 3, 'hard = attribution/dramatic/meta only');
  assert.deepEqual(styleIssues(r, { level: 'soft' }).map((x) => x.slice(0, 12)), ['ประโยคยาวเกิน ', 'คำเฟ้อ 1 ครั้ง'].map((x) => x.slice(0, 12)));
  // วงตรวจ 9 ก.ย.: คำกำกวมไม่อยู่ในด่านแข็ง
  const neutral = styleReport('ชายในคลิปเสียชีวิตทันที กล้องเห็นทะเบียนชัดเจน เขาพยายามติดต่อญาติ');
  assert.deepEqual([neutral.attribution, neutral.dramatic, neutral.meta, neutral.filler], [0, 0, 0, 0], 'พยายาม is not filler: removing it changes meaning');
  assert.deepEqual(styleIssues(neutral, { level: 'hard' }), []);
  assert.equal(styleReport('').words, 0);
  assert.deepEqual(styleIssues(styleReport('')), []);
});

// ★ 9 ก.ย. 69 (เจ้าของ เคสออย-บีม): ด่านสำนวนระดับ soft "คำมองจากนอก + เปิดเรื่องป้ายบทบาทซ้อนชื่อ"
test('styleReport flags outsider words and role-label openings as soft observations only', () => {
  const r = styleReport('ออย ภรรยาของ บีม กวี คบหาดูใจกับฝ่ายชายนานถึง 13 ปีก่อนตัดสินใจแต่งงาน');
  assert.equal(r.outsider, 1, 'ฝ่ายชาย');
  assert.deepEqual(r.matches.outsider, ['ฝ่ายชาย']);
  assert.equal(typeof r.roleLabelOpening, 'string', JSON.stringify(r.roleLabelOpening));
  assert.ok(r.roleLabelOpening.includes('ภรรยาของ'), r.roleLabelOpening);
  const soft = styleIssues(r, { level: 'soft' });
  assert.equal(soft.filter((x) => x.startsWith('คำมองจากนอก')).length, 1, JSON.stringify(soft));
  assert.ok(soft.some((x) => x.includes('ป้ายบทบาทซ้อนชื่อ') && x.includes(r.roleLabelOpening)), JSON.stringify(soft));
  assert.deepEqual(styleIssues(r, { level: 'hard' }), [], 'ทั้งสองข้อเป็นข้อสังเกต ห้ามตกด่านแข็ง');
  // ช่องว่างรอบ "ของ" มีหรือไม่มีก็ได้
  assert.ok(styleReport('ออย ภรรยาของบีม กวี เล่าเรื่องเก่า').roleLabelOpening?.includes('ภรรยาของ'));

  // เนกาทีฟ: เปิดด้วยผู้กระทำ + เรียกชื่อคน = ไม่มีข้อสังเกต
  const clean = styleReport('ออยกับบีม กวี คบหาดูใจกันมา 13 ปีก่อนแต่งงาน');
  assert.equal(clean.outsider, 0);
  assert.equal(clean.roleLabelOpening, null);
  assert.deepEqual(styleIssues(clean, { level: 'soft' }), []);
  // ป้ายบทบาทที่ไม่ได้อยู่ประโยคแรก = ไม่จับ (ด่านนี้ดูเฉพาะประโยคเปิด)
  assert.equal(styleReport('ออยเล่าเรื่องความรักในรายการ\nออยเป็นภรรยาของบีมมา 13 ปี').roleLabelOpening, null);
  // ขึ้นต้นด้วยคำบทบาทเลย ไม่มีชื่อนำหน้า = ภาษาธรรมชาติ
  assert.equal(styleReport('แม่ของน้องมะลิพาลูกไปหาหมอ').roleLabelOpening, null);
  assert.equal(styleReport('เธอเดินไปหาฝ่ายชาย ส่วนฝ่ายหญิงยืนรอ').outsider, 2, 'นับทั้งฝ่ายชายและฝ่ายหญิง');

  // กันถอยหลัง: หมวดเดิมต้องไม่เปลี่ยน
  const old = styleReport('ตำรวจระบุว่าเขาไม่อยู่บ้าน');
  assert.equal(old.attribution, 1);
  assert.ok(styleIssues(old, { level: 'hard' }).some((x) => x.includes('อ้างที่มาในเนื้อเรื่อง') && x.includes('ระบุว่า')));
  assert.deepEqual(styleIssues(old, { level: 'soft' }), []);
  assert.equal(styleReport('').roleLabelOpening, null);
});

// ★ 9 ก.ย. 69 (เจ้าของ เคสออย-บีม 7+5 ครั้ง/เอกสาร): ด่านสำนวนระดับ soft "คำแทนคู่ซ้ำเกิน 2 ต่อท่อน"
test('styleReport counts pair pronouns and flags only more than the max, as a soft observation', () => {
  assert.equal(STYLE_PAIR_PRONOUN_MAX, 2, 'เพดานต่อท่อน = 2 (เกินจึงติด)');

  const r = styleReport('ทั้งคู่ไปตลาด\nทั้งคู่ซื้อผัก\nทั้งคู่กลับบ้าน');
  assert.equal(r.pair, 3);
  assert.deepEqual(r.matches.pair, ['ทั้งคู่', 'ทั้งคู่', 'ทั้งคู่']);
  const soft = styleIssues(r, { level: 'soft' });
  assert.equal(soft.filter((x) => x.startsWith('คำแทนคู่ 3 ครั้ง')).length, 1, JSON.stringify(soft));
  assert.ok(soft.some((x) => x.includes('(ทั้งคู่)') && x.includes('เกิน 2 ต่อท่อน')), JSON.stringify(soft));
  assert.deepEqual(styleIssues(r, { level: 'hard' }), [], 'คำแทนคู่เป็นข้อสังเกต ห้ามตกด่านแข็ง');

  // ขอบเขต: เท่ากับเพดานพอดี ยังไม่ติด (ผสม 2 คำก็นับรวมท่อนเดียวกัน)
  const edge = styleReport('ทั้งคู่ไปตลาด แล้วสองคนกลับบ้าน');
  assert.equal(edge.pair, 2);
  assert.deepEqual(edge.matches.pair, ['ทั้งคู่', 'สองคน']);
  assert.deepEqual(styleIssues(edge, { level: 'soft' }).filter((x) => x.startsWith('คำแทนคู่')), [], 'เท่ากับ 2 ยังไม่ติด');

  // ผสม: ทั้งคู่ 1 + สองคน 2 = 3 → ติด และรายชื่อคำที่เจอถูกยุบซ้ำก่อนแสดง
  const mixed = styleReport('ทั้งคู่เดินเข้าบ้าน\nสองคนช่วยกันเก็บของ\nสองคนนั่งพักหน้าบ้าน');
  assert.equal(mixed.pair, 3);
  assert.deepEqual(mixed.matches.pair, ['ทั้งคู่', 'สองคน', 'สองคน']);
  assert.ok(styleIssues(mixed, { level: 'soft' }).some((x) => x.startsWith('คำแทนคู่ 3 ครั้ง') && x.includes('(ทั้งคู่ / สองคน)')),
    JSON.stringify(styleIssues(mixed, { level: 'soft' })));

  // นับตัวอักษรตรงตัวเหมือนหมวดอื่น: "ทั้งสองคน" = สำนวนแข็งแบบเดียวกัน จึงนับ
  assert.deepEqual(styleReport('ทั้งสองคนเดินไปด้วยกัน').matches.pair, ['สองคน']);

  // เนกาทีฟ: เรียกชื่อคน = ไม่มีคำแทนคู่เลย และไม่มีข้อสังเกตใดๆ
  const clean = styleReport('ออยกับบีม กวี เดินไปตลาด\nออยเลือกผัก บีม กวี จ่ายเงิน');
  assert.equal(clean.pair, 0);
  assert.deepEqual(clean.matches.pair, []);
  assert.deepEqual(styleIssues(clean), []);
  assert.equal(styleReport('').pair, 0);

  // กันถอยหลัง: หมวดเดิมไม่ขยับเพราะหมวดใหม่
  assert.deepEqual([r.attribution, r.dramatic, r.filler, r.meta, r.outsider, r.longSentences], [0, 0, 0, 0, 0, 0]);
  const old = styleReport('ทั้งคู่ระบุว่าเหนื่อย ทั้งคู่ถึงกับน้ำตาคลอ ทั้งคู่เดินกลับ');
  assert.equal(old.pair, 3);
  assert.equal(old.attribution, 1);
  assert.equal(old.dramatic, 2);
  assert.deepEqual(styleIssues(old, { level: 'hard' }).length, 2, 'ด่านแข็งยังเป็นของหมวดเดิมล้วน');
});

test('scoreTopicDoc carries style reports for every story and the main story', () => {
  const doc = fixture();
  doc.stories[0].story = 'เขาบอกว่าเหนื่อย\n' + doc.stories[0].story;
  doc.mainStory = 'คลิปปิดท้ายด้วยรอยยิ้ม\n' + (doc.mainStory || '');
  const r = scoreTopicDoc(doc);
  assert.equal(r.stories[0].style.attribution, 1);
  assert.equal(r.summary.mainStoryStyle.meta, 1);
  assert.ok(Array.isArray(r.stories[0].style.matches.attribution));
});
