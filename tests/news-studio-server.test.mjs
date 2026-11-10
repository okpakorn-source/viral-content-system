// ข้อสอบ "ชั้นต่อสายของสตูดิโอเขียนข่าว" (10 พ.ย. 69) — ตัวเรียกโมเดล + รูปข้อมูลงานในคลังประวัติ
// import โค้ดจริงตรงๆ · client ของโมเดลเป็นตัวปลอม · ไม่ยิง API ไม่แตะฐานข้อมูล
// รัน: node --test tests/news-studio-server.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { studioModels, makeAnthropicCaller, makeOpenAIJsonCaller, STUDIO_BUDGET } from '../src/lib/services/newsStudio/callers.js';
import {
  RUN_LIMITS, newRunId, isRunId, startedRun, finishedRun, failedRun, effectiveStatus, listRow, validateReview,
  recentTeacherIds, overflowRunIds, runStats, mergeReview, quotaState,
} from '../src/lib/services/newsStudio/runStore.js';

// ───────── ① โมเดลของแต่ละบทบาท ─────────
test('โมเดลตั้งต้น = ชุดที่ผ่านการทดลอง · เปลี่ยนได้ด้วย env · ค่าที่มีเครื่องหมายคำพูดครอบถูกแกะ', () => {
  const m = studioModels({});
  assert.equal(m.writer.model, 'claude-opus-4-8');
  assert.equal(m.writer.effort, 'medium');
  assert.equal(m.writer.thinking, false);
  assert.deepEqual([m.checker.thinking, m.checker.effort, m.director.thinking, m.director.effort], [true, 'high', true, 'high'], 'งานตรวจและงานตัดสินใจต้องคิดก่อนตอบ');
  assert.equal(m.analyzer.model, 'gpt-5.4-mini');
  const o = studioModels({ NEWS_STUDIO_WRITER_MODEL: '"claude-x"', NEWS_STUDIO_CHECKER_MODEL: ' claude-y ', NEWS_STUDIO_ANALYZER_MODEL: 'gpt-z' });
  assert.equal(o.writer.model, 'claude-x');
  assert.equal(o.director.model, 'claude-x', 'บทบาทที่ไม่ได้ตั้งเอง = ใช้ตัวเดียวกับนักเขียน');
  assert.equal(o.checker.model, 'claude-y');
  assert.equal(o.analyzer.model, 'gpt-z');
  for (const role of Object.values(m)) assert.ok(role.timeoutMs >= 30000 && role.timeoutMs <= 180000 && role.maxTokens > 0, 'ทุกบทบาทต้องมีเพดานเวลาและเพดานความยาว');
});

// ───────── ② ตัวเรียก Claude ─────────
const anthropicFake = (reply, seen = []) => ({ messages: { create: async (req, opts) => { seen.push({ req, opts }); if (reply instanceof Error) throw reply; return reply; } } });
const okReply = (text, extra = {}) => ({ content: [{ type: 'thinking', thinking: 'คิด' }, { type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 11, output_tokens: 7 }, ...extra });
const spec = { model: 'claude-opus-4-8', effort: 'high', thinking: true, maxTokens: 16000, timeoutMs: 180000 };

test('ตัวเรียก Claude: ส่ง system/user ตรงตัว · คืนข้อความล้วนไม่แปลง · บันทึกการใช้งานตามบทบาท', async () => {
  const seen = [];
  const used = [];
  const text = 'ฆ่าเชื้อแล้ว พิมพ์ 10 หน้า "ผมไม่อยากให้แม่ลำบาก"'; // ถ้อยคำที่ตัวกรองคำของท่อเดิมจะแทนผิด — ต้องออกมาเหมือนเดิมทุกตัว
  const call = makeAnthropicCaller({ client: anthropicFake(okReply(text), seen), spec, role: 'ผู้ตรวจข้อเท็จจริง', logUsage: (u) => { used.push(u); } });
  assert.equal(await call({ system: 'กฎ', user: 'เนื้อ' }), text);
  const { req, opts } = seen[0];
  assert.deepEqual(req, { model: 'claude-opus-4-8', max_tokens: 16000, output_config: { effort: 'high' }, system: 'กฎ', messages: [{ role: 'user', content: 'เนื้อ' }], thinking: { type: 'adaptive' } });
  assert.ok(!('temperature' in req), 'โมเดลชุดนี้ไม่รับ temperature');
  assert.deepEqual(opts, { timeout: 180000, maxRetries: 0 }, "SDK ไม่ลองซ้ำเอง (ลองซ้ำหลังหมดเวลา = เวลาคูณสอง)");
  assert.deepEqual(used, [{ provider: 'anthropic', model: 'claude-opus-4-8', inputTokens: 11, outputTokens: 7, feature: 'newsStudio:ผู้ตรวจข้อเท็จจริง' }]);
  // บทบาทที่ไม่คิดก่อนตอบ ต้องไม่ส่ง thinking
  const seen2 = [];
  await makeAnthropicCaller({ client: anthropicFake(okReply('ก'), seen2), spec: { ...spec, thinking: false }, role: 'นักเขียน' })({ system: 's', user: 'u' });
  assert.ok(!('thinking' in seen2[0].req));
});

test('ตัวเรียก Claude: ไม่มีคีย์ / ถูกปฏิเสธ / คำตอบถูกตัด / ตอบว่าง / เรียกล้ม = error ที่บอกเหตุและบทบาท (ไม่ปล่อยเป็นเนื้อข่าว)', async () => {
  const type = async (p) => { try { await p; return 'ไม่โยน'; } catch (e) { return `${e.errorType}|${e.message}`; } };
  assert.match(await type(makeAnthropicCaller({ client: null, spec, role: 'นักเขียน' })({ system: 's', user: 'u' })), /^ANTHROPIC_KEY_MISSING\|.*นักเขียน.*ANTHROPIC_API_KEY/);
  assert.match(await type(makeAnthropicCaller({ client: anthropicFake(okReply('', { stop_reason: 'refusal', stop_details: { category: 'safety' } })), spec, role: 'นักเขียน' })({ system: 's', user: 'u' })), /^MODEL_REFUSED\|นักเขียนปฏิเสธคำขอ \(safety\)/);
  assert.match(await type(makeAnthropicCaller({ client: anthropicFake(okReply('ครึ่งเดียว', { stop_reason: 'max_tokens' })), spec, role: 'นักเขียน' })({ system: 's', user: 'u' })), /^MODEL_OUTPUT_TRUNCATED\|/);
  assert.match(await type(makeAnthropicCaller({ client: anthropicFake(okReply('   ')), spec, role: 'นักเขียน' })({ system: 's', user: 'u' })), /^MODEL_EMPTY\|/);
  const boom = Object.assign(new Error('rate limited sk-ant-xxxx'), { status: 429 });
  const failed = await type(makeAnthropicCaller({ client: anthropicFake(boom), spec, role: 'นักเขียน' })({ system: 's', user: 'u' }));
  assert.match(failed, /^MODEL_CALL_FAILED\|เรียกนักเขียนไม่สำเร็จ \(HTTP 429\)/);
  // ตัวบันทึกการใช้งานพัง (โยน หรือ promise ล้ม) ต้องไม่ทำให้งานเขียนพัง
  assert.equal(await makeAnthropicCaller({ client: anthropicFake(okReply('ผ่าน')), spec, role: 'นักเขียน', logUsage: () => { throw new Error('db ล่ม'); } })({ system: 's', user: 'u' }), 'ผ่าน');
  assert.equal(await makeAnthropicCaller({ client: anthropicFake(okReply('ผ่าน')), spec, role: 'นักเขียน', logUsage: () => Promise.reject(new Error('db ล่ม')) })({ system: 's', user: 'u' }), 'ผ่าน');
});

// ───────── ③ ตัวเรียก OpenAI ─────────
test('ตัวเรียก OpenAI: บังคับ JSON · คืน object · ตอบไม่เป็น JSON / ไม่มีคีย์ / เรียกล้ม = error บอกเหตุ', async () => {
  const seen = [];
  const used = [];
  const client = { chat: { completions: { create: async (req, opts) => { seen.push({ req, opts }); return { choices: [{ message: { content: '{"primaryCategory":"สู้ชีวิต"}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }; } } } };
  const ospec = { model: 'gpt-5.4-mini', maxTokens: 800, timeoutMs: 45000 };
  const call = makeOpenAIJsonCaller({ client, spec: ospec, role: 'ตัววิเคราะห์หมวดข่าว', logUsage: (u) => { used.push(u); } });
  assert.deepEqual(await call('คำถาม'), { primaryCategory: 'สู้ชีวิต' });
  assert.deepEqual(seen[0].req, { model: 'gpt-5.4-mini', messages: [{ role: 'user', content: 'คำถาม' }], max_completion_tokens: 800, response_format: { type: 'json_object' } });
  assert.deepEqual(seen[0].opts, { timeout: 45000, maxRetries: 0 });
  assert.equal(used[0].feature, 'newsStudio:ตัววิเคราะห์หมวดข่าว');
  const bad = { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'ขออภัย' } }] }) } } };
  await assert.rejects(() => makeOpenAIJsonCaller({ client: bad, spec: ospec, role: 'บรรณารักษ์' })('x'), (e) => e.errorType === 'MODEL_BAD_JSON');
  await assert.rejects(() => makeOpenAIJsonCaller({ client: null, spec: ospec, role: 'บรรณารักษ์' })('x'), (e) => e.errorType === 'OPENAI_KEY_MISSING');
  const down = { chat: { completions: { create: async () => { throw Object.assign(new Error('timeout'), { status: 504 }); } } } };
  await assert.rejects(() => makeOpenAIJsonCaller({ client: down, spec: ospec, role: 'บรรณารักษ์' })('x'), (e) => e.errorType === 'MODEL_CALL_FAILED' && e.message.includes('HTTP 504'));
});

// ───────── ④ รูปข้อมูลงานในคลังประวัติ ─────────
const RESULT = {
  ok: true, title: 'น้องเอขายข้าวแกงส่งตัวเองเรียน', rawText: 'เนื้อดิบ',
  analysis: { primaryCategory: 'สู้ชีวิต', emotionalTags: ['ชื่นชม'], extra: 'ทิ้ง' },
  direction: { ok: true, error: '', angles: [{ core: 'แก่น', focus: 'ชู', coverLines: ['ก', 'ข'], order: ['1'], mustKeep: ['50,000 บาท'], exemplarIds: ['a05'], why: 'เพราะ', inventedQuotes: [] }] },
  researchFacts: [],
  versions: [1, 2, 3].map((i) => ({
    index: i, ok: i !== 3, content: i === 3 ? '' : `เนื้อเวอร์ชัน ${i}`, attempts: i, trail: [{ attempt: 1, fails: ['EMOJI'], factMajor: 0, factChecked: true, readerClear: true }],
    angle: { core: 'แก่น', focus: 'ชู', coverLines: ['ก'], order: [], mustKeep: [], exemplarIds: ['a05'], why: '' },
    teacher: { id: `fb_${i}`, name: `ครู ${i}`, category: 'สู้ชีวิต', views: 1e6, url: 'https://x', openingType: 'number', post: 'โพสต์ครูฉบับเต็ม '.repeat(50), reason: 'รูปเรื่องตรง' },
    formOk: i !== 3, fails: [], warns: [{ code: 'NUMBERS_MISSING', message: 'เตือน' }], metrics: { words: 180, paragraphs: 3, chars: 650, charLimit: 700, paragraphChars: [160, 330, 160], rawCopyPct: 40, rawRun: 30, missingNumbers: 0 },
    factChecked: true, factIssues: [{ type: 'added', severity: 'minor', quote: 'ก', problem: 'ข', fix: 'ค' }], factError: '',
    readChecked: true, readClear: true, readOpening: 'บอกเรื่อง', readGist: 'ใจความ', readHardParts: [], readError: '',
    ...(i === 3 ? { error: 'โมเดลล่ม', errorType: 'WRITER_FAILED' } : {}),
  })),
  summary: { requested: 3, written: 2, passed: 2, formPassed: 2, factChecked: 3, readClear: 3 },
  warnings: [{ code: 'LIBRARIAN_PARTIAL', message: 'เติมครูสำรอง' }],
  timings: { direction: 9000, writing: 30000, total: 41000 },
};

test('รหัสงาน: ขึ้นต้น ns_ ไม่ชนคลังอื่น · ตรวจรูปได้ · ของแปลกปลอมไม่ผ่าน', () => {
  const id = newRunId(1794300000000, 0.123456);
  assert.match(id, /^ns_1794300000000_[a-z0-9]{5,8}$/);
  assert.ok(isRunId(id));
  for (const bad of ['', 'ns_', 'abc', '../etc/passwd', 'ns_123_x', 'ns_1794300000000_AB!', null]) assert.equal(isRunId(bad), false, String(bad));
  assert.notEqual(newRunId(1, 0.1), newRunId(1, 0.9));
});

test('งาน 1 งาน: เริ่ม → จบ เก็บครบทุกด่านแต่ไม่เก็บโพสต์ครูฉบับเต็ม · งานล้มเก็บเหตุ · งานค้างนาน = หยุดกลางทาง', () => {
  const user = { username: 'pao', displayName: 'เปา', role: 'admin' };
  const row = startedRun({ id: 'ns_1794300000000_abcde', rawText: 'บรรทัดแรกของข่าว\nบรรทัดสอง', useResearch: true, user, createdAt: '2026-11-10T10:00:00.000Z' });
  assert.equal(row.status, 'running');
  assert.equal(row.title, 'บรรทัดแรกของข่าว');
  assert.deepEqual(row.user, { username: 'pao', displayName: 'เปา' }, 'ไม่เก็บบทบาท/ข้อมูลอื่นของผู้ใช้');
  assert.deepEqual(row.review, { status: 'unreviewed', note: '', pickedVersion: null, by: '', at: '' });

  const done = finishedRun(row, { result: RESULT, models: { writer: { model: 'claude-opus-4-8' } }, finishedAt: '2026-11-10T10:00:41.000Z' });
  assert.equal(done.status, 'done');
  assert.equal(done.title, RESULT.title);
  assert.equal(done.rawText, 'บรรทัดแรกของข่าว\nบรรทัดสอง', 'เนื้อดิบที่ส่งเข้ายังอยู่');
  assert.deepEqual(done.analysis, { primaryCategory: 'สู้ชีวิต', emotionalTags: ['ชื่นชม'] });
  assert.equal(done.versions.length, 3);
  assert.ok(!JSON.stringify(done).includes('โพสต์ครูฉบับเต็ม'), 'ห้ามเก็บโพสต์ครูฉบับเต็มซ้ำทุกงาน');
  assert.deepEqual(done.versions[0].teacher, { id: 'fb_1', name: 'ครู 1', category: 'สู้ชีวิต', views: 1e6, url: 'https://x', openingType: 'number', reason: 'รูปเรื่องตรง' });
  assert.deepEqual(done.versions[0].metrics.paragraphChars, [160, 330, 160]);
  assert.equal(done.versions[0].factIssues[0].fix, 'ค');
  assert.equal(done.versions[2].error, 'โมเดลล่ม', 'เวอร์ชันที่เขียนไม่สำเร็จยังอยู่พร้อมเหตุ');
  assert.ok(!('inventedQuotes' in done.direction.angles[0]));
  assert.ok(JSON.stringify(done).length < 12000, `แถวต้องเล็ก (${JSON.stringify(done).length} ตัวอักษร)`);

  const failed = failedRun(row, { error: 'เขียนไม่สำเร็จทั้ง 3 เวอร์ชัน', errorType: 'ALL_VERSIONS_FAILED', finishedAt: '2026-11-10T10:01:00.000Z' });
  assert.deepEqual([failed.status, failed.errorType, failed.rawText], ['failed', 'ALL_VERSIONS_FAILED', row.rawText]);
  assert.equal(failedRun(row, { error: 'x', finishedAt: '' }).errorType, 'NEWS_STUDIO_FAILED');

  const t0 = Date.parse(row.createdAt);
  assert.equal(effectiveStatus(row, t0 + 60000), 'running');
  assert.equal(effectiveStatus(row, t0 + RUN_LIMITS.staleRunningMs + 1), 'stale');
  assert.equal(effectiveStatus(done, t0 + 9e9), 'done');
});

test('แถวย่อของหน้ารายการ: ไม่มีเนื้อข่าว/เวอร์ชันเต็ม แต่มีสิ่งที่ต้องใช้ตัดสินใจเปิดดู', () => {
  const row = startedRun({ id: 'ns_1794300000000_abcde', rawText: 'เนื้อดิบยาวๆ', user: null, createdAt: '2026-11-10T10:00:00.000Z' });
  const done = finishedRun(row, { result: RESULT, models: null, finishedAt: '2026-11-10T10:00:41.000Z' });
  const l = listRow(done, Date.parse('2026-11-10T10:05:00.000Z'));
  assert.deepEqual(Object.keys(l).sort(), ['caseId', 'category', 'coverLines', 'createdAt', 'directionOk', 'error', 'finishedAt', 'id', 'rawChars', 'review', 'seconds', 'source', 'status', 'summary', 'title', 'user', 'warningCodes']);
  assert.deepEqual([l.status, l.seconds, l.category, l.coverLines, l.warningCodes, l.rawChars], ['done', 41, 'สู้ชีวิต', ['ก'], ['LIBRARIAN_PARTIAL'], 12]);
  assert.ok(!JSON.stringify(l).includes('เนื้อเวอร์ชัน'));
  assert.equal(listRow(row, Date.parse(row.createdAt) + RUN_LIMITS.staleRunningMs + 5).status, 'stale');
});

test('รีวิวของคน: รับเฉพาะสถานะที่รู้จัก · "นำไปใช้แล้ว" ต้องบอกเวอร์ชัน · หมายเหตุถูกตัดความยาว', () => {
  const user = { username: 'pao', displayName: 'เปา' };
  const ok = validateReview({ status: 'used', pickedVersion: '2', note: `  ${'ก'.repeat(900)}` }, { versionCount: 3, user, now: '2026-11-10T11:00:00.000Z' });
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.review.status, ok.review.pickedVersion, ok.review.by, ok.review.at, ok.review.note.length], ['used', 2, 'เปา', '2026-11-10T11:00:00.000Z', RUN_LIMITS.noteMax]);
  assert.equal(validateReview({ status: 'good' }, { user }).review.pickedVersion, null);
  assert.equal(validateReview({ status: 'used' }, { user }).errorType, 'PICKED_VERSION_REQUIRED');
  assert.equal(validateReview({ status: 'used', pickedVersion: 4 }, { versionCount: 3, user }).errorType, 'BAD_PICKED_VERSION');
  assert.equal(validateReview({ status: 'good', pickedVersion: 1.5 }, { user }).errorType, 'BAD_PICKED_VERSION');
  assert.equal(validateReview({ status: 'เยี่ยม' }, { user }).errorType, 'BAD_REVIEW_STATUS');
  assert.equal(validateReview(null, { user }).errorType, 'BAD_REVIEW_STATUS');
});

test('ครูที่เพิ่งใช้ · งานเกินเพดานคลัง · ตัวเลขรวม', () => {
  const mk = (n, status = 'done', extra = {}) => ({
    id: `ns_${1794300000000 + n}_aaaaa`, status, createdAt: new Date(Date.parse('2026-11-10T00:00:00.000Z') + n * 60000).toISOString(),
    versions: status === 'done' ? [{ content: 'ก', ok: n % 2 === 0, attempts: 1, teacher: { id: `t${n}a` } }, { content: 'ข', ok: true, attempts: 2, teacher: { id: `t${n}b` } }, { content: '', ok: false, attempts: 0, teacher: { id: 'tshared' } }] : [],
    timings: status === 'done' ? { total: (30 + n) * 1000 } : null, review: { status: n === 1 ? 'good' : 'unreviewed' }, ...extra,
  });
  const runs = [mk(1), mk(2), mk(3, 'failed'), mk(4), mk(5, 'running')];
  assert.deepEqual(recentTeacherIds(runs, 2), ['t4a', 't4b', 'tshared', 't2a', 't2b'], 'ใหม่สุดก่อน · เฉพาะงานที่เสร็จ · ไม่ซ้ำ');
  assert.deepEqual(recentTeacherIds([], 5), []);

  const now = Date.parse('2026-11-10T00:06:00.000Z');
  assert.deepEqual(overflowRunIds(runs, 3, now), [mk(2).id], 'ลบเก่าสุดที่เกินเพดาน · งานที่คนรีวิวแล้ว (งานแรก) ถูกเก็บนานกว่า');
  assert.deepEqual(overflowRunIds(runs, 10, now), []);
  const oldRunning = [mk(9), mk(8), mk(3, 'running')];
  assert.deepEqual(overflowRunIds(oldRunning, 2, Date.parse(oldRunning[2].createdAt) + 60000), [], 'งานที่กำลังเขียนอยู่ห้ามลบ');
  assert.deepEqual(overflowRunIds(oldRunning, 2, Date.parse(oldRunning[2].createdAt) + RUN_LIMITS.staleRunningMs + 1), [oldRunning[2].id], 'งานค้างที่หยุดกลางทางลบได้');

  const s = runStats(runs, now);
  assert.deepEqual([s.total, s.done, s.failed, s.versions, s.versionsPassed, s.firstTry, s.medianSeconds], [5, 3, 1, 6, 5, 2, 32]);
  assert.deepEqual(s.reviewed, { good: 1, bad: 0, used: 0 });
  assert.equal(runStats([], now).medianSeconds, null);
});

// ───────── ⑤ งบเวลา · ลองซ้ำเฉพาะล้มเร็ว ─────────
test('งบเวลา: รอบแรกและรอบแก้ต้องจบก่อนเส้นตายแข็ง และเส้นตายแข็งต้องต่ำกว่า maxDuration 300 ของ route', () => {
  const m = studioModels({});
  const sec = (x) => x.timeoutMs / 1000;
  const firstRound = sec(m.director) + sec(m.librarian) + sec(m.writer) + Math.max(sec(m.checker), sec(m.reader));
  const retryRound = STUDIO_BUDGET.retryDeadlineMs / 1000 + sec(m.writer) + Math.max(sec(m.checker), sec(m.reader));
  assert.ok(sec(m.analyzer) <= sec(m.director), 'ตัววิเคราะห์เดินขนานกับผู้กำหนดทิศทาง ต้องไม่ช้ากว่า');
  assert.ok(firstRound <= STUDIO_BUDGET.hardMs / 1000, `รอบแรกช้าสุด ${firstRound} วิ`);
  assert.ok(retryRound <= STUDIO_BUDGET.hardMs / 1000, `รอบแก้ช้าสุด ${retryRound} วิ`);
  assert.ok(STUDIO_BUDGET.hardMs < 300000);
});

test('ล้มเร็วด้วยเหตุชั่วคราว = ลองอีก 1 ครั้ง · ล้มช้า/เหตุถาวร = ไม่ลองซ้ำ', async () => {
  const mkClient = (errors) => { let n = 0; return { calls: () => n, messages: { create: async () => { const e = errors[n++]; if (e) throw e; return okReply('ผ่าน'); } } }; };
  const err = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
  const clock = (elapsed) => { let t = 0; return { now: () => { const v = t; t += elapsed; return v; }, wait: async () => {} }; };
  const overloaded = mkClient([err(529)]);
  assert.equal(await makeAnthropicCaller({ client: overloaded, spec, role: 'นักเขียน', retryClock: clock(2000) })({ system: 's', user: 'u' }), 'ผ่าน');
  assert.equal(overloaded.calls(), 2, 'โมเดลแน่นแล้วล้มเร็ว = ลองอีกครั้ง');
  const twice = mkClient([err(529), err(529)]);
  await assert.rejects(() => makeAnthropicCaller({ client: twice, spec, role: 'นักเขียน', retryClock: clock(2000) })({ system: 's', user: 'u' }), (e) => e.errorType === 'MODEL_CALL_FAILED');
  assert.equal(twice.calls(), 2, 'ลองซ้ำครั้งเดียว ไม่วน');
  const slow = mkClient([err(503)]);
  await assert.rejects(() => makeAnthropicCaller({ client: slow, spec, role: 'นักเขียน', retryClock: clock(STUDIO_BUDGET.quickRetryWithinMs + 1) })({ system: 's', user: 'u' }));
  assert.equal(slow.calls(), 1, 'ล้มช้า (ใกล้หมดเวลา) ไม่ลองซ้ำ');
  const bad = mkClient([err(400)]);
  await assert.rejects(() => makeAnthropicCaller({ client: bad, spec, role: 'นักเขียน', retryClock: clock(100) })({ system: 's', user: 'u' }));
  assert.equal(bad.calls(), 1, 'คำขอผิดรูป ลองซ้ำก็ไม่ช่วย');
});

// ───────── ⑥ รีวิวแบบส่งเฉพาะช่องที่เปลี่ยน · โควตา ─────────
test('รีวิว: คำขอส่งเฉพาะช่องที่เปลี่ยน ช่องอื่นคงตามที่เก็บอยู่ (จอค้างค่าเก่าไม่ทับของคนอื่น)', () => {
  const user = { username: 'pao', displayName: 'เปา' };
  const stored = { status: 'used', pickedVersion: 2, note: 'ของเดิม', by: 'อีกคน', at: 'เมื่อกี้' };
  const noteOnly = mergeReview(stored, { note: 'แก้คำผิดย่อหน้า 2' }, { user });
  assert.deepEqual([noteOnly.ok, noteOnly.review.status, noteOnly.review.pickedVersion, noteOnly.review.note], [true, 'used', 2, 'แก้คำผิดย่อหน้า 2'], 'บันทึกหมายเหตุอย่างเดียวต้องไม่แตะสถานะ/เวอร์ชันที่เลือก');
  const toGood = mergeReview(stored, { status: 'good' }, { user });
  assert.deepEqual([toGood.review.status, toGood.review.pickedVersion, toGood.review.note], ['good', null, 'ของเดิม'], 'เวอร์ชันที่เลือกมีความหมายเฉพาะ "นำไปใช้แล้ว"');
  const pick = mergeReview({ status: 'good', pickedVersion: null, note: 'x' }, { status: 'used', pickedVersion: 3 }, { user });
  assert.deepEqual([pick.review.status, pick.review.pickedVersion, pick.review.note], ['used', 3, 'x']);
  assert.equal(mergeReview(stored, { status: 'used' }, { user }).review.pickedVersion, 2, 'ยังเป็น "นำไปใช้แล้ว" = คงเวอร์ชันเดิม');
  assert.equal(mergeReview(null, { status: 'used' }, { user }).errorType, 'PICKED_VERSION_REQUIRED');
  assert.equal(mergeReview(stored, {}, { user }).errorType, 'EMPTY_REVIEW');
  assert.equal(mergeReview(stored, null, { user }).errorType, 'EMPTY_REVIEW');
  assert.equal(mergeReview(stored, { status: 'เยี่ยม' }, { user }).errorType, 'BAD_REVIEW_STATUS');
  const clear = mergeReview(stored, { status: 'unreviewed', pickedVersion: null }, { user });
  assert.deepEqual([clear.review.status, clear.review.pickedVersion], ['unreviewed', null]);
});

test('โควตา: นับจากคลังประวัติ (ทั้งระบบ · ต่อคน · งานที่กำลังเขียนจริง ไม่นับงานค้างที่หยุดกลางทาง)', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  const at = (minAgo, status, username) => ({ id: `ns_${1794300000000 + minAgo}_aaaaa`, status, createdAt: new Date(now - minAgo * 60000).toISOString(), user: { username } });
  const runs = [at(1, 'running', 'pao'), at(5, 'done', 'pao'), at(30, 'done', 'mai'), at(59, 'failed', 'pao'), at(61, 'done', 'pao'), at(20, 'running', 'mai'), at(60 * 25, 'done', 'pao')];
  assert.deepEqual(quotaState(runs, { username: 'pao', now }), { running: 1, hourAll: 5, hourUser: 3, dayAll: 6 }, 'งาน running ที่ค้างเกิน 12 นาทีไม่นับเป็นกำลังเขียน');
  assert.deepEqual(quotaState([], { username: 'pao', now }), { running: 0, hourAll: 0, hourUser: 0, dayAll: 0 });
  assert.equal(quotaState(runs, { now }).hourUser, 0);
});
