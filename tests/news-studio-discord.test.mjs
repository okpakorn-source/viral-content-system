// ข้อสอบ "ระบบเขียนตัวใหม่ในท่อ Discord" (10 พ.ย. 69) — ผลที่ส่งกลับต้องอยู่ในรูปที่บอท/route/คลังผลงานอ่านได้จริง
// import โค้ดจริงตรงๆ · ใช้ฟังก์ชันประกอบข้อความของบอทตัวจริง (ตัดจากซอร์ส discord-bot/index.js) · ไม่ยิง API ไม่แตะฐานข้อมูล
// รัน: node --test tests/news-studio-discord.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toLegacyData, toLegacyVersion, toGenerationLog, runQualityWarnings, versionConcerns, fullyPassed } from '../src/lib/services/newsStudio/legacyResult.js';
import * as switches from '../src/lib/services/newsStudio/switches.js';
import { startedRun, finishedRun, quotaState, listRow, mergeRecentTeacherIds, RECENT_ROW_ID, isRunId, RECENT_TEACHER_CAP, overflowRunIds } from '../src/lib/services/newsStudio/runStore.js';
import { runDiscordStudioJob, fallbackWarning, DISCORD_BUDGET } from '../src/lib/services/newsStudio/discordCore.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const botSrc = read('../discord-bot/index.js');
const routeSrc = read('../src/app/api/auto/process/route.js');
const flowSrc = read('../src/lib/services/newsStudio/discordFlow.js');

// ตัวประกอบบรรทัดเตือนของบอทตัวจริง
const buildWarningLines = new Function('BOT_RESULT_WARNINGS', 'WARNING_LINE_MAX', 'readViralScore',
  `${botSrc.match(/function buildWarningLines\(version\) \{[\s\S]*?\n\}/u)[0]}; return buildWarningLines;`)(true, 220, () => null);

const version = (i, over = {}) => ({
  index: i, ok: true, content: `ย่อหน้าแรกของเวอร์ชัน ${i}\n\nย่อหน้ากลาง\n\nย่อหน้าท้าย`, attempts: 1, trail: [], stopped: '',
  angle: { core: 'แก่น', focus: 'ชู', coverLines: [`พาดปกบรรทัดแรกของเวอร์ชัน ${i}`, 'บรรทัดสอง'], order: [], mustKeep: [], exemplarIds: ['a05'], why: '' },
  teacher: { id: `fb_${i}`, name: `[สู้ชีวิต] ครู ${i}`, category: 'สู้ชีวิต', views: 1e6, url: '', openingType: 'number', reason: '' },
  formOk: true, fails: [], warns: [], metrics: { words: 180, paragraphs: 3, chars: 650, charLimit: 700, paragraphChars: [160, 330, 160], rawCopyPct: 40, rawRun: 30 },
  factChecked: true, factIssues: [], factError: '', readChecked: true, readClear: true, readOpening: 'บอกเรื่อง', readGist: 'ใจความ', readHardParts: [], readError: '',
  ...over,
});
const makeRun = (versions, extra = {}) => ({
  id: 'ns_1794300000000_abcde', status: 'done', source: 'discord', createdAt: '2026-11-10T10:00:00.000Z', user: { username: 'discord-123', displayName: 'discord-123' },
  title: 'น้องเอขายข้าวแกงส่งตัวเองเรียน', rawText: 'เนื้อดิบที่พนักงานส่ง\nบรรทัดสอง', analysis: { primaryCategory: 'สู้ชีวิต', emotionalTags: ['ชื่นชม'] },
  versions, summary: { requested: 3, written: versions.filter((v) => v.content).length, passed: versions.filter((v) => v.ok).length },
  warnings: [], timings: { direction: 9000, teachers: 2000, writing: 30000, total: 41000 }, models: { writer: { model: 'claude-opus-4-8' } }, ...extra,
});

test('ผลที่ส่งกลับ: มีทุกช่องที่บอทและ /api/auto/process อ่าน · เวอร์ชันที่เขียนไม่สำเร็จไม่ถูกส่งเป็นข่าวเปล่า', () => {
  const run = makeRun([version(1), version(2), version(3, { content: '', ok: false, error: 'โมเดลล่ม' })]);
  const data = toLegacyData(run, { caseId: '07601' });
  // ช่องที่บอทอ่าน (discord-bot/index.js pollJobUntilDone)
  assert.deepEqual(data.generationLog, { caseId: '07601' });
  assert.equal(data.newsData.newsTitle, 'น้องเอขายข้าวแกงส่งตัวเองเรียน');
  assert.equal(data.newsData.newsBody, run.rawText, 'คลังข่าวเก่าใช้เนื้อดิบเป็นเนื้อข่าว');
  assert.equal(data.analysisResult.versions.length, 2, 'ส่งเฉพาะเวอร์ชันที่มีเนื้อ');
  assert.ok(data.analysisResult.versions.every((v) => v.content.length > 0 && v._sourceLabel && v.style && v.promptId && v.title));
  assert.deepEqual(data.analysisResult.researchItems, []);
  assert.deepEqual(data.simulatedComments, [], 'บอทเรียก c.type.toUpperCase() ไม่กัน — ต้องส่งรายการว่าง');
  assert.equal(data.breakdownData, null);
  assert.equal(data.totalTimeSeconds, 41);
  assert.equal(data.usedPromptInfo.source, 'news-studio');
  assert.equal(data.pipelineLabel, 'ระบบเขียนตัวใหม่');
  assert.equal(data.studioRunId, run.id);
  assert.match(data.analysisResult.qualityWarnings[0], /เขียนได้ 2 จาก 3 เวอร์ชัน \(เวอร์ชัน 3 เขียนไม่สำเร็จ\)/);
  assert.equal(toLegacyData(run).generationLog, null, 'ไม่มีเลขเคส = บอทไม่โชว์ลิงก์ (ไม่ส่งลิงก์เสีย)');
  // ช่องที่ route อ่านจากผลของตัวเขียน (ทุกตัวต้องมี หรือถูก optional-chain ไว้แล้ว)
  for (const key of ['analysisResult', 'usedPromptInfo', 'totalTimeSeconds', 'newsData', 'breakdownData', 'factPool', 'log']) assert.ok(key in data, key);
  assert.ok(Array.isArray(data.log));
});

test('ป้ายของแต่ละเวอร์ชันใน Discord: เลขเวอร์ชัน + พาดปกบรรทัดแรก · แถบเขียวเฉพาะเวอร์ชันที่ผ่านและตรวจครบ · ท้าย embed สืบถึงครูได้', () => {
  const good = toLegacyVersion(version(1), { title: 'หัวข่าว' });
  assert.equal(good._sourceLabel, 'เวอร์ชัน 1 · พาดปกบรรทัดแรกของเวอร์ชัน 1');
  assert.equal(good.style, 'ทิศทาง: พาดปกบรรทัดแรกของเวอร์ชัน 1 / บรรทัดสอง | ครู: [สู้ชีวิต] ครู 1');
  assert.deepEqual([good._source, good.promptId, good.title], ['enhanced', 'fb_1', 'หัวข่าว']);
  assert.deepEqual(buildWarningLines(good), [], 'เวอร์ชันที่ผ่านครบ ไม่มีบรรทัดเตือนใต้ข่าว');
  const embedTitle = `[${good._sourceLabel}] หัวข่าว`.slice(0, 250);
  assert.ok(embedTitle.length <= 250 && embedTitle.startsWith('[เวอร์ชัน 1 · '));

  const noAngle = toLegacyVersion(version(2, { angle: null }));
  assert.equal(noAngle._sourceLabel, 'เวอร์ชัน 2');
  assert.match(noAngle.style, /^ไม่มีทิศทางจากต้นแบบปก \| ครู:/);
  const longCover = toLegacyVersion(version(1, { angle: { coverLines: ['ก'.repeat(300)] } }));
  assert.ok(longCover._sourceLabel.length <= 80 && longCover.style.length <= 240);
});

test('เวอร์ชันที่ยังมีจุดให้ตรวจ: พนักงานเห็นเหตุใต้ข่าวผ่านบรรทัดเตือนของบอทตัวจริง · ด่านที่ไม่ได้ตรวจไม่ถูกนับว่าผ่าน', () => {
  const v = version(2, {
    ok: false, formOk: false,
    fails: [{ code: 'TOO_LONG', message: 'ยาวเกินไป' }, { code: 'OPENING_MISSES_POINT', message: 'ย่อหน้าแรก…' }],
    factIssues: [
      { type: 'missing', severity: 'minor', quote: 'ค่าแรง 350', problem: 'โพสต์ไม่ได้บอกค่าแรงวันละ 350 บาท', fix: '' },
      { type: 'added', severity: 'major', quote: 'ทำงานหนักทุกวัน', problem: 'เนื้อข่าวไม่ได้บอกว่างานหนัก', fix: '' },
    ],
    stopped: 'เวลาของงานใกล้หมด จึงไม่ได้แก้รอบถัดไป',
  });
  assert.equal(fullyPassed(v), false);
  assert.deepEqual(versionConcerns(v), ['ยังไม่ผ่านแบบแผน: ยาวเกิน · ย่อหน้าแรกยังไม่ถึงประเด็น', 'ผู้ตรวจข้อเท็จจริงพบจุดร้ายแรง 1 จุด', 'หยุดแก้ก่อนครบรอบ: เวลาของงานใกล้หมด จึงไม่ได้แก้รอบถัดไป']);
  const legacy = toLegacyVersion(v);
  assert.equal(legacy._source, 'needs_review', 'ไม่ใช่ enhanced = บอทใช้แถบชมพู');
  const lines = buildWarningLines(legacy);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^⚠️ อาจตกข้อเท็จจริง: โพสต์ไม่ได้บอกค่าแรงวันละ 350 บาท/u, 'ช่อง "ตกข้อเท็จจริง" ใช้กับแก่นที่ขาดเท่านั้น');
  assert.match(lines[1], /^⚠️ ยังไม่ผ่านแบบแผน: ยาวเกิน/u);
  assert.match(lines[2], /^⚠️ ผู้ตรวจข้อเท็จจริงชี้: “ทำงานหนักทุกวัน” เนื้อข่าวไม่ได้บอกว่างานหนัก/u);
  assert.ok(lines.every((l) => l.length <= 220));

  const unchecked = version(3, { factChecked: false, readChecked: false, factError: 'ล่ม', readError: 'ล่ม' });
  assert.equal(fullyPassed(unchecked), false, 'ผ่านแต่ไม่ได้ตรวจ ≠ ผ่าน');
  assert.deepEqual(versionConcerns(unchecked), ['ยังไม่ได้ตรวจข้อเท็จจริง (ผู้ตรวจล่ม)', 'ยังไม่ได้ตรวจการอ่าน (ผู้อ่านล่ม)']);
  assert.equal(toLegacyVersion(unchecked)._source, 'needs_review');
  const teaser = version(1, { ok: false, readClear: false, readOpening: 'เกริ่น' });
  assert.deepEqual(versionConcerns(teaser), ['คนอ่านยังไม่รู้เรื่องจากย่อหน้าแรก (เกริ่น)']);

  const run = makeRun([version(1), v, unchecked], { warnings: [{ code: 'NO_DIRECTION', message: 'กำหนดทิศทางข่าวไม่สำเร็จ — เวอร์ชันทั้งหมดเขียนโดยไม่มีทิศทางจากต้นแบบ' }, { code: 'RUN_NOT_SAVED', message: 'ภายใน' }] });
  const q = runQualityWarnings(run);
  assert.deepEqual(q, ['เวอร์ชัน 2, 3 ยังมีจุดให้ตรวจก่อนโพสต์ (ดูบรรทัดเตือนใต้ข่าว)', 'กำหนดทิศทางข่าวไม่สำเร็จ — เวอร์ชันทั้งหมดเขียนโดยไม่มีทิศทางจากต้นแบบ'], 'คำเตือนภายในของคลังประวัติไม่ส่งถึงพนักงาน');
  assert.deepEqual(runQualityWarnings(makeRun([version(1), version(2), version(3)])), []);
});

test('ข้อมูลที่ส่งเข้าคลัง "ผลงานที่เขียนแล้ว": ใช้เฉพาะช่องที่ตัวบันทึกเก็บ · ติดป้ายว่าเป็นระบบใหม่ · สืบกลับถึงงานในสตูดิโอได้', () => {
  const run = makeRun([version(1), version(2), version(3)]);
  const g = toGenerationLog(run, { userId: 'discord-123', deskMeta: { lane: 'x' } });
  assert.deepEqual([g.sourceType, g.userId, g.newsTitle, g.versions.length, g.breakdownData], ['plain_text', 'discord-123', run.title, 3, null]);
  assert.equal(g.sourceText, run.rawText);
  assert.deepEqual(Object.keys(g.pipelineInfo).sort(), ['desk', 'newsType', 'promptId', 'promptMatchType', 'promptName', 'promptScore', 'promptSource', 'stepTimings', 'totalTime'], 'ช่องนอกรายการนี้ถูกตัวบันทึกทิ้งเงียบๆ');
  assert.deepEqual([g.pipelineInfo.promptSource, g.pipelineInfo.promptId, g.pipelineInfo.newsType, g.pipelineInfo.totalTime, g.pipelineInfo.desk], ['news-studio', run.id, 'สู้ชีวิต', 41, { lane: 'x' }]);
  assert.ok(g.versions.every((v) => v.usedModel === 'claude-opus-4-8' && v.style.startsWith('ทิศทาง:')), 'คลังผลงานแสดง style ข้าง "เวอร์ชัน N —"');
  assert.equal(toGenerationLog(makeRun([version(1)], { rawText: 'ก'.repeat(9000) })).sourceText.length, 5000);
});

test('งานจาก Discord ไม่กินโควตาของหน้าเว็บ · อยู่ในประวัติพร้อมป้ายที่มาและเลขเคส · จำครูที่เพิ่งใช้ด้วยแถวเล็กแถวเดียว', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  const at = (minAgo, source, status = 'done') => ({ id: `ns_${1794300000000 + minAgo}_aaaaa`, status, source, createdAt: new Date(now - minAgo * 60000).toISOString(), user: { username: source === 'discord' ? 'discord-1' : 'pao' } });
  const runs = [at(1, 'discord', 'running'), at(2, 'discord'), at(3, 'discord'), at(4, 'studio'), at(5, 'studio', 'running')];
  assert.deepEqual(quotaState(runs, { username: 'pao', now }), { running: 1, hourAll: 2, hourUser: 2, dayAll: 2 }, 'นับเฉพาะงานจากหน้าสตูดิโอ');

  const row = startedRun({ id: 'ns_1794300000000_abcde', rawText: 'เนื้อดิบ', user: { username: 'discord-123' }, createdAt: '2026-11-10T10:00:00.000Z', source: 'discord' });
  assert.deepEqual([row.source, row.caseId], ['discord', '']);
  assert.equal(startedRun({ id: 'ns_1_a', rawText: 'x', createdAt: '' }).source, 'studio');
  assert.equal(startedRun({ id: 'ns_1_a', rawText: 'x', createdAt: '', source: 'อื่น' }).source, 'studio', 'ค่าแปลกปลอม = หน้าเว็บ');
  const l = listRow({ ...row, status: 'done', caseId: '07601' }, now);
  assert.deepEqual([l.source, l.caseId], ['discord', '07601']);

  assert.equal(isRunId(RECENT_ROW_ID), false, 'แถวจำครูต้องไม่ปนกับรายการงาน');
  assert.deepEqual(mergeRecentTeacherIds(['a', 'b', 'c'], ['c', 'd']), ['c', 'd', 'a', 'b'], 'ใหม่สุดก่อน ไม่ซ้ำ');
  assert.equal(mergeRecentTeacherIds(Array.from({ length: 40 }, (_, i) => `t${i}`), ['x']).length, RECENT_TEACHER_CAP);
  assert.deepEqual(mergeRecentTeacherIds(null, [null, '', 'a']), ['a']);
});

test('สายไฟใน /api/auto/process: งานข้อความล้วนจากบอทเข้าระบบใหม่ · งานอื่นและสวิตช์ปิดใช้ท่อเดิม · ล้มแล้วโยน ไม่คืน success:false', () => {
  assert.ok(routeSrc.includes("import { processNewsStudioText, shouldUseStudioForJob, fallbackWarning } from '@/lib/services/newsStudio/discordFlow';"));
  const branch = routeSrc.slice(routeSrc.indexOf('const _isTextJob ='), routeSrc.indexOf('if (delegateRes.success)'));
  assert.match(branch, /if \(_isTextJob && shouldUseStudioForJob\(body\)\) \{[\s\S]*?delegateRes = await processNewsStudioText\(\{/);
  assert.match(branch, /\} else if \(_isTextJob\) \{[\s\S]*?delegateRes = await processAutoFlowText\(\{/, 'ท่อเดิมของงานข้อความต้องยังอยู่ครบ (ทางถอย + งานจากหน้าเว็บ)');
  assert.match(branch, /delegateRes = await processAutoFlow\(\{/, 'ท่อ URL ต้องไม่ถูกแตะ');
  assert.ok(branch.indexOf('processNewsStudioText') < branch.indexOf('processAutoFlowText({'), 'ต้องตัดสินก่อนเข้าท่อเดิม');
  // ตัวตัดสิน: ค่าตั้งต้นเปิด · ปิดด้วย NEWS_STUDIO_DISCORD=0 · เฉพาะงานจากบอท
  const pick = switches;
  const bot = { userId: 'discord-123', _botInstance: 'bot-a', input: 'ข่าว' };
  assert.equal(pick.shouldUseStudioForJob(bot, {}), true, 'ไม่ตั้งอะไร = ใช้ระบบใหม่');
  assert.equal(pick.shouldUseStudioForJob({ _botInstance: 'bot-a' }, {}), true);
  for (const off of ['0', 'off', 'false', 'no', 'legacy', ' "0" ', 'OFF']) assert.equal(pick.shouldUseStudioForJob(bot, { NEWS_STUDIO_DISCORD: off }), false, `ปิดด้วย ${off}`);
  assert.equal(pick.shouldUseStudioForJob(bot, { NEWS_STUDIO_DISCORD: '1' }), true);
  for (const web of [{ userId: 'web-user' }, { userId: 'mobile-pao' }, { userId: 'desk-ทีม' }, {}, null]) assert.equal(pick.shouldUseStudioForJob(web, {}), false, `งานจาก ${JSON.stringify(web)} ต้องใช้ท่อเดิม`);
  assert.equal(pick.isStudioDiscordResearchOn({}), false, 'ค้นเสริมปิดเป็นค่าตั้งต้น');
  assert.equal(pick.isStudioDiscordResearchOn({ NEWS_STUDIO_DISCORD_RESEARCH: '1' }), true);
  // ตัวต่อของจริงต้องส่งของครบให้แกน (พฤติกรรมของแกน — สำเร็จ/ล้ม/บันทึกเคสไม่ได้ — มีข้อสอบรันจริงด้านล่าง)
  assert.ok(flowSrc.includes('return runDiscordStudioJob(p, { runStudioJob, logGeneration, attachCaseId, logPipeline, useResearch: isStudioDiscordResearchOn() });'));
  assert.ok(flowSrc.includes("import { logGeneration } from '@/lib/services/era/generationLogger';"), 'ต้องใช้ตัวบันทึกเคสตัวเดียวกับท่อเดิม (คลังผลงานเดียวกัน)');
});

test('ข่าวที่มีทิศทางเดียว: ป้ายของแต่ละเวอร์ชันใน Discord ต้องบอกสิ่งที่ต่าง (วิธีเปิดของครู) ไม่ซ้ำกันสามใบ', () => {
  const same = { core: 'แก่น', focus: 'ชู', coverLines: ['พาดปกเดียวกัน', 'บรรทัดสอง'], order: [], mustKeep: [], exemplarIds: ['a05'], why: '' };
  const t = (i, openingType) => ({ id: `fb_${i}`, name: `ครู ${i}`, category: 'อบอุ่นใจ', views: 1, url: '', openingType, reason: '' });
  const data = toLegacyData(makeRun([version(1, { angle: same, teacher: t(1, 'number') }), version(2, { angle: same, teacher: t(2, 'quote') }), version(3, { angle: same, teacher: t(3, 'ไม่รู้จัก') })]));
  assert.deepEqual(data.analysisResult.versions.map((v) => v._sourceLabel), ['เวอร์ชัน 1 · เปิดด้วยตัวเลข', 'เวอร์ชัน 2 · เปิดด้วยคำพูด', 'เวอร์ชัน 3 · พาดปกเดียวกัน'], 'ไม่รู้วิธีเปิด = คงป้ายพาดปก');
  assert.ok(data.analysisResult.versions.every((v) => v.style.startsWith('ทิศทาง: พาดปกเดียวกัน')), 'บรรทัดในคลังผลงานยังบอกทิศทางเต็ม');
  const mixed = toLegacyData(makeRun([version(1), version(2), version(3)]));
  assert.deepEqual(mixed.analysisResult.versions.map((v) => v._sourceLabel), ['เวอร์ชัน 1 · พาดปกบรรทัดแรกของเวอร์ชัน 1', 'เวอร์ชัน 2 · พาดปกบรรทัดแรกของเวอร์ชัน 2', 'เวอร์ชัน 3 · พาดปกบรรทัดแรกของเวอร์ชัน 3'], 'ทิศทางต่างกัน = ป้ายพาดปกตามเดิม');
});

// ───────── พฤติกรรมจริงของทางเข้าท่อ Discord (แกน discordCore.js · ของจริงถูกแทนด้วยตัวปลอม) ─────────
test('งานสำเร็จ: คืน success + ผลรูปเดิม + เลขเคส · บอกระบบว่าเป็นงานจากบอท · รอผูกเลขเคสก่อนคืนผล', async () => {
  const calls = { job: null, logged: null, attached: null, pipeline: [] };
  const run = makeRun([version(1), version(2), version(3)]);
  let attachDone = false;
  const out = await runDiscordStudioJob({ text: ' เนื้อดิบ\r\nบรรทัดสอง ', user: { userId: 'discord-123', userName: 'discord-123' }, workflowId: 'wf1', deskMeta: { lane: 'x' } }, {
    runStudioJob: async (a) => { calls.job = a; return run; },
    logGeneration: async (g) => { calls.logged = g; return { success: true, caseId: '07601' }; },
    attachCaseId: async (id, c) => { await new Promise((r) => setTimeout(r, 5)); calls.attached = [id, c]; attachDone = true; },
    logPipeline: async (e) => { calls.pipeline.push(e); },
    useResearch: false,
  });
  assert.equal(out.success, true);
  assert.deepEqual([calls.job.rawText, calls.job.source, calls.job.useResearch, calls.job.user.username], ['เนื้อดิบ\nบรรทัดสอง', 'discord', false, 'discord-123']);
  assert.deepEqual(calls.job.budget, DISCORD_BUDGET, 'งานจากคิวใช้งบเวลาของคิว ไม่ใช่ของหน้าเว็บ');
  assert.ok(DISCORD_BUDGET.hardMs > 285000 && DISCORD_BUDGET.hardMs < 770000 - 240000, 'ต้องจบก่อนเส้นตายของคิว แม้ตามด้วยการบันทึกเคส');
  assert.deepEqual(out.data.generationLog, { caseId: '07601' });
  assert.equal(out.data.analysisResult.versions.length, 3);
  assert.deepEqual(calls.attached, [run.id, '07601']);
  assert.equal(attachDone, true, 'ต้องรอผูกเลขเคสเสร็จก่อนคืนผล');
  assert.deepEqual([calls.logged.userId, calls.logged.pipelineInfo.desk], ['discord-123', { lane: 'x' }]);
  assert.deepEqual(calls.pipeline.map((e) => `${e.step}:${e.status}`), ['news-studio:success']);
});

test('งานล้มทุกแบบ = โยน Error ที่มี failedStep + errorType (ไม่คืน success:false / undefined)', async () => {
  const base = { logGeneration: async () => ({ success: true, caseId: '1' }), attachCaseId: async () => {} };
  const p = { text: 'เนื้อดิบ', user: { userId: 'discord-1' } };
  const caught = async (deps) => { try { const r = await runDiscordStudioJob(p, { ...base, ...deps }); return { returned: r }; } catch (e) { return { message: e.message, failedStep: e.failedStep, errorType: e.errorType }; } };
  assert.deepEqual(await caught({ runStudioJob: async () => ({ id: 'ns_1_a', status: 'failed', error: 'เขียนไม่สำเร็จทั้ง 3 เวอร์ชัน', errorType: 'ALL_VERSIONS_FAILED' }) }),
    { message: 'เขียนไม่สำเร็จทั้ง 3 เวอร์ชัน', failedStep: 'news_studio_write', errorType: 'ALL_VERSIONS_FAILED' });
  const notStarted = await caught({ runStudioJob: async () => { throw Object.assign(new Error('คลังล่ม'), { errorType: 'TEACHER_LIBRARY_UNREADABLE' }); } });
  assert.deepEqual([notStarted.failedStep, notStarted.errorType], ['news_studio_start', 'TEACHER_LIBRARY_UNREADABLE']);
  assert.match(notStarted.message, /ระบบเขียนข่าวเริ่มงานไม่ได้: คลังล่ม/);
  for (const weird of [undefined, null, {}, { status: 'running' }]) {
    const r = await caught({ runStudioJob: async () => weird });
    assert.equal(r.failedStep, 'news_studio_write', `ผลแปลก ${JSON.stringify(weird)} ต้องถูกนับเป็นล้ม`);
    assert.equal(r.errorType, 'NEWS_STUDIO_FAILED');
    assert.ok(!('returned' in r));
  }
});

test('บันทึกเคสไม่ได้ / ผูกเลขเคสล้ม / ตัวบันทึกขั้นตอนพัง: พนักงานยังได้ข่าว พร้อมคำเตือนที่ตรงความจริง', async () => {
  const run = makeRun([version(1), version(2), version(3)]);
  const p = { text: 'เนื้อดิบ', user: { userId: 'discord-1' } };
  for (const logGeneration of [async () => ({ success: false, caseId: null, error: 'GENERATION_LOG_NOT_SAVED' }), async () => { throw new Error('ฐานข้อมูลล่ม'); }, async () => undefined]) {
    let attached = false;
    const out = await runDiscordStudioJob(p, { runStudioJob: async () => run, logGeneration, attachCaseId: async () => { attached = true; } });
    assert.equal(out.success, true);
    assert.equal(out.data.generationLog, null, 'ไม่มีเลขเคส = ไม่ส่งลิงก์เสีย');
    assert.equal(out.data.analysisResult.versions.length, 3);
    assert.ok(out.data.analysisResult.qualityWarnings.some((w) => w.includes('ไม่มีลิงก์ดูย้อนหลัง')));
    assert.equal(attached, false);
  }
  const out = await runDiscordStudioJob(p, {
    runStudioJob: async () => run, logGeneration: async () => ({ success: true, caseId: '07602' }),
    attachCaseId: async () => { throw new Error('ผูกไม่ได้'); }, logPipeline: () => { throw new Error('ตัวบันทึกพัง'); },
  });
  assert.deepEqual([out.success, out.data.generationLog.caseId], [true, '07602']);
  assert.deepEqual(out.data.analysisResult.qualityWarnings, []);
});

test('ระบบใหม่ล้มแล้ว route ส่งต่อให้นักเขียนชุดเดิม: พนักงานต้องเห็นว่าข่าวมาจากระบบเดิมและเพราะอะไร · ล้มช้าเกินไม่ส่งต่อ', () => {
  const w = fallbackWarning(Object.assign(new Error('เรียกนักเขียนไม่สำเร็จ (HTTP 529): overloaded\nบรรทัดสอง'), { errorType: 'ALL_VERSIONS_FAILED' }));
  assert.match(w, /^ให้พนักงานตรวจบริบทก่อนโพสต์: ข่าวนี้เขียนด้วยระบบเดิม เพราะระบบเขียนตัวใหม่ล้ม \(เรียกนักเขียนไม่สำเร็จ \(HTTP 529\): overloaded บรรทัดสอง\)$/u, 'ขึ้นต้นด้วยวลีที่บอทดันขึ้นบรรทัดแรก');
  assert.ok(fallbackWarning(new Error('ก'.repeat(900))).length < 260);
  const branch = routeSrc.slice(routeSrc.indexOf('const _isTextJob ='), routeSrc.indexOf('if (delegateRes.success)'));
  assert.match(branch, /catch \(studioErr\) \{\s*if \(Date\.now\(\) - startTime > STUDIO_FALLBACK_WITHIN_MS\) throw studioErr;/u, 'ล้มช้าเกิน = โยนต่อ ไม่เรียกท่อเดิมซ้อน');
  assert.match(branch, /if \(delegateRes\) \{[\s\S]*?\} else if \(_isTextJob\) \{[\s\S]*?processAutoFlowText\(\{[\s\S]*?text:\s+detection\.textContent \|\| input,/u, 'ท่อเดิมได้อาร์กิวเมนต์ชุดเดิม');
  assert.match(branch, /_ar\.qualityWarnings = \[fallbackWarning\(_studioFailure\), \.\.\./u);
  const ms = Number(routeSrc.match(/const STUDIO_FALLBACK_WITHIN_MS = (\d+);/)[1]);
  assert.ok(ms < DISCORD_BUDGET.hardMs, 'งานที่ชนเส้นตายแข็งของระบบใหม่ต้องไม่ถูกส่งต่อ (เวลาไม่พอ)');
  // เงื่อนไข "เป็นงานข้อความ" ต้องตรงกับของเดิมตัวอักษรต่อตัวอักษร (เทียบไฟล์สำรองก่อนแก้ ถ้ามี)
  const cond = "detection.inputType === 'plain_text' || (!detection.primaryUrl && detection.hasText)";
  assert.ok(branch.includes(`const _isTextJob = ${cond};`));
  assert.ok(routeSrc.includes('...(err.errorType ? { errorType: err.errorType } : {}),'), 'ส่งชนิดเหตุต่อเฉพาะเมื่อมี — ทางล้มของท่อเดิมต้องได้คำตอบรูปเดิม');
});

test('เพดานประวัติแยกตามที่มา: งานจาก Discord ไม่ดันงานของหน้าสตูดิโอออก · งานที่คนรีวิวแล้วเก็บนานกว่า', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  const mk = (n, source, extra = {}) => ({ id: `ns_${1794300000000 + n}_${source[0]}aaaa`, status: 'done', source, createdAt: new Date(now - n * 60000).toISOString(), review: { status: 'unreviewed' }, ...extra });
  const studio = [mk(900, 'studio'), mk(800, 'studio', { review: { status: 'used' } }), mk(700, 'studio')];
  const discord = Array.from({ length: 8 }, (_, i) => mk(i + 1, 'discord'));
  assert.deepEqual(overflowRunIds([...studio, ...discord], 5, now), [mk(6, 'discord').id, mk(7, 'discord').id, mk(8, 'discord').id], 'ลบเฉพาะงาน Discord ที่เกินเพดานของ Discord');
  const reviewedOld = [...Array.from({ length: 5 }, (_, i) => mk(i + 1, 'studio')), mk(50, 'studio', { review: { status: 'good' } }), mk(60, 'studio')];
  assert.deepEqual(overflowRunIds(reviewedOld, 5, now), [mk(60, 'studio').id], 'งานที่รีวิวแล้วยังอยู่ แม้เกินเพดาน');
  const veryOld = [...Array.from({ length: 10 }, (_, i) => mk(i + 1, 'studio')), mk(99, 'studio', { review: { status: 'good' } })];
  assert.ok(overflowRunIds(veryOld, 5, now).includes(mk(99, 'studio').id), 'เกินสองเท่าของเพดาน = ลบแม้รีวิวแล้ว');
  assert.deepEqual(overflowRunIds([mk(1, 'discord'), mk(2, 'discord', { status: 'running' })], 1, now), [], 'งานที่กำลังเขียนห้ามลบ');
});
