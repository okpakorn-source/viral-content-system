// ✍️ ข้อสอบนักเขียน F2X (29 ต.ค. 69 · เจ้าของ "F2X สวยฉันอ่านแล้ว เขียนลงระบบจริงเลย") — จำลองโมเดล ไม่ยิง API จริง
//   A. สวิตช์ปิดค่าเริ่มต้น · คำสั่งตรงกับตัวที่สอบผ่านในห้องทดลอง · เลือกตัวอย่างหมวดเดียวกัน · คลังตัวอย่างเข้า file tracing
//   B. เขียน 1 ฉบับ: ตรวจข้อเท็จจริงทุกครั้ง · จุดหนักเท่านั้นที่ส่งแก้ · ตรวจไม่สำเร็จ/ล้ม/หมดเวลา = โยน (ห้ามส่งฉบับที่ไม่ผ่านการตรวจ)
//   C. ท่อนจริงใน autoFlowServiceText: ปิดสวิตช์ = เส้นเดิม · เปิด = ข้าม correction/บก.เกลาเฉพาะฉบับ F2X · มุมล้ม = ถอยนักเขียนเดิม/ตัดมุมการ์ดหลวม
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': `${ROOT}src` }, interopDefault: true });
const F = await jiti.import(`${ROOT}src/lib/services/f2xWriter.js`);
const SRC = readFileSync(`${ROOT}src/lib/services/autoFlowServiceText.js`, 'utf8').replace(/\r\n/g, '\n'); // working copy บน Windows = CRLF (core.autocrlf)
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const withEnv = async (vars, fn) => {
  const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const RAW = 'ข่าวสมมติ: "น้องมะลิ ใจดี" นักเรียนชั้น ม.6 สอบติดพยาบาล หลังพ่อป่วยฟอกไตสัปดาห์ละ 2 ครั้ง น้องบอกว่า "หนูอยากกลับมาดูแลคนในหมู่บ้าน"';
const POOL = [
  { id: 'p1', views: 9e6, genre: 'สู้ชีวิต', caption: 'สู้ชีวิต 9 ล้าน' },
  { id: 'p2', views: 8e6, genre: 'น้ำดี', caption: 'น้ำดี 8 ล้าน' },
  { id: 'p3', views: 7e6, genre: 'สู้ชีวิต', caption: 'สู้ชีวิต 7 ล้าน' },
  { id: 'p4', views: 6.5e6, genre: 'สู้ชีวิต', caption: 'สู้ชีวิต 6.5 ล้าน' },
  { id: 'p5', views: 6e6, genre: 'ความรัก', caption: 'ความรัก 6 ล้าน' },
  { id: 'p6', views: 5.8e6, genre: 'สู้ชีวิต', caption: 'สู้ชีวิต 5.8 ล้าน' },
  { id: 'p7', views: 5.5e6, genre: 'สู้ชีวิต', caption: 'สู้ชีวิต 5.5 ล้าน' },
  { id: 'p8', views: 5.1e6, genre: 'อาลัย', caption: 'อาลัย 5.1 ล้าน' },
];

test('A1 สวิตช์ปิดค่าเริ่มต้น · เปิดเฉพาะ F2X_WRITER=1', async () => {
  await withEnv({ F2X_WRITER: undefined }, () => assert.equal(F.isF2xWriterEnabled(), false));
  for (const v of ['0', 'true', 'yes', 'on', '']) await withEnv({ F2X_WRITER: v }, () => assert.equal(F.isF2xWriterEnabled(), false, v));
  for (const v of ['1', ' 1 ', '"1"']) await withEnv({ F2X_WRITER: v }, () => assert.equal(F.isF2xWriterEnabled(), true, v));
});

test('A2 คำสั่งตรงกับตัวที่สอบผ่านในห้องทดลองทุกตัวอักษร (นักเขียน · ผู้ใช้ · ตรวจ · แก้)', () => {
  const ex = POOL.slice(0, 2);
  assert.equal(F.f2xWriterSystem(ex), 'คุณคือแอดมินเพจข่าวไวรัล "รวมไอจีดารา" ที่เขียนโพสต์เข้าถึงหลายล้านคนเป็นประจำ\nนี่คือโพสต์จริงของเพจที่เข้าถึงหลายล้านคน:\n\n--- ตัวอย่าง 1 (เข้าถึง 9.0 ล้าน) ---\nสู้ชีวิต 9 ล้าน\n\n--- ตัวอย่าง 2 (เข้าถึง 8.0 ล้าน) ---\nน้ำดี 8 ล้าน\n\n' + F.F2X_RULES);
  assert.equal(F.f2xWriterUser('ดิบ'), 'ข่าวดิบ:\nดิบ\n\nเขียนโพสต์ข่าวนี้ 1 ชิ้นสำหรับเพจ ให้อยู่ระดับเดียวกับตัวอย่าง (เข้าถึง 5–10 ล้าน) ความยาวใกล้เคียงตัวอย่าง');
  assert.match(F.F2X_RULES, /^กติกาข้อเท็จจริง \(ห้ามละเมิด\):\n- ใช้ข้อเท็จจริงจากข่าวดิบเท่านั้น/);
  assert.match(F.F2X_RULES, /ห้ามเดาเพศจากชื่อ/);
  assert.match(F.F2X_FACT_SYS, /^คุณคือบรรณาธิการตรวจข้อเท็จจริงที่เข้มงวด เทียบโพสต์กับข่าวดิบ/);
  assert.match(F.F2X_FACT_SYS, /"severity":"หนัก\|เบา"/);
  assert.match(F.F2X_FIX_SYS, /แก้เฉพาะจุดที่ระบุ: ตัดออก หรือเปลี่ยนให้ตรงกับดิบ\n- ห้ามแตะส่วนอื่นของโพสต์ ห้ามเพิ่มข้อมูลใหม่/);
  assert.equal(F.F2X_WRITER_MODEL, 'claude-fable-5-1');
  assert.equal(F.F2X_CHECK_MODEL, 'gpt-5.6-sol');
});

test('A3 เลือกตัวอย่าง: หมวดเดียวกันยอดสูงสุด ≤4 + ที่เหลือตามยอด รวม 6 · หมวดว่าง = ยอดสูงสุด 6', () => {
  assert.deepEqual(F.pickF2xExemplars('สู้ชีวิต', 6, POOL).map((p) => p.id), ['p1', 'p3', 'p4', 'p6', 'p2', 'p5']);
  assert.deepEqual(F.pickF2xExemplars('สู้ชีวิต/ฝ่าฟัน', 6, POOL).map((p) => p.id), ['p1', 'p3', 'p4', 'p6', 'p2', 'p5'], 'เทียบเฉพาะคำหน้า /');
  assert.deepEqual(F.pickF2xExemplars('', 6, POOL).map((p) => p.id), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  assert.deepEqual(F.pickF2xExemplars('อาลัย', 6, POOL).map((p) => p.id), ['p8', 'p1', 'p2', 'p3', 'p4', 'p5']);
});

test('A4 คลังตัวอย่างจริง: ≥12 ชิ้น ยอด ≥5 ล้าน มีหมวด · อยู่ใน outputFileTracingIncludes ครบ 4 route', () => {
  const pool = F.loadF2xPool();
  assert.ok(pool.length >= 12);
  assert.ok(pool.every((p) => p.views >= 5e6 && p.caption.trim() && typeof p.genre === 'string'));
  const cfg = readFileSync(`${ROOT}next.config.mjs`, 'utf8');
  for (const route of ['/api/auto', '/api/auto/process', '/api/queue/worker', '/api/summarize']) {
    const line = cfg.split('\n').find((l) => l.trim().startsWith(`'${route}':`));
    assert.ok(line && line.includes('./data/f2x-exemplars.json'), route);
  }
});

const draftWriter = (texts) => { const calls = []; return { calls, fn: async (a) => { calls.push(a); return texts[Math.min(calls.length - 1, texts.length - 1)]; } }; };
const checker = (issues) => { const calls = []; return { calls, fn: async (a) => { calls.push(a); return typeof issues === 'function' ? issues(a) : { issues }; } }; };

test('B1 ไม่มีจุดหนัก = ใช้ร่างนักเขียน · ตรวจ 1 ครั้งด้วยดิบ+โพสต์ · นักเขียนได้ตัวอย่างหมวดเดียวกัน', async () => {
  const w = draftWriter(['โพสต์ร่าง']); const c = checker([{ text: 'x', why: 'y', severity: 'เบา' }]);
  const r = await F.writeF2xVersion({ rawText: RAW, genreInfo: { genre: 'สู้ชีวิต' }, callWriter: w.fn, callChecker: c.fn, pool: POOL });
  assert.equal(r.text, 'โพสต์ร่าง'); assert.equal(r.fixed, 0); assert.equal(r.lightIssues, 1);
  assert.equal(w.calls.length, 1); assert.equal(c.calls.length, 1);
  assert.equal(w.calls[0].system, F.f2xWriterSystem(F.pickF2xExemplars('สู้ชีวิต', 6, POOL)));
  assert.equal(w.calls[0].user, F.f2xWriterUser(RAW.trim()));
  assert.equal(c.calls[0].system, F.F2X_FACT_SYS); assert.equal(c.calls[0].effort, 'medium');
  assert.equal(c.calls[0].user, `=== ข่าวดิบ ===\n${RAW.trim()}\n\n=== โพสต์ ===\nโพสต์ร่าง\n=== จบ ===`);
  assert.deepEqual(r.exemplarIds, ['p1', 'p3', 'p4', 'p6', 'p2', 'p5']);
});

test('B2 มีจุดหนัก = ส่งแก้เฉพาะจุดหนัก (จุดเบาไม่ส่ง) · ใช้ฉบับแก้', async () => {
  const w = draftWriter(['ร่างมีอายุ 17 ปี', 'ร่างแก้แล้ว']);
  const c = checker((a) => (a.user.includes('ร่างแก้แล้ว') ? { issues: [] } : { issues: [{ text: 'อายุ 17 ปี', why: 'ดิบไม่บอกอายุ', severity: 'หนัก' }, { text: 'สำนวน', why: 'เล็กน้อย', severity: 'เบา' }] }));
  const r = await F.writeF2xVersion({ rawText: RAW, genreInfo: { genre: '' }, callWriter: w.fn, callChecker: c.fn, pool: POOL });
  assert.equal(r.text, 'ร่างแก้แล้ว'); assert.equal(r.fixed, 1); assert.deepEqual(r.heavyIssues, ['อายุ 17 ปี']);
  assert.equal(w.calls.length, 2);
  assert.equal(w.calls[1].system, F.F2X_FIX_SYS);
  assert.equal(w.calls[1].user, `ข่าวดิบ:\n${RAW.trim()}\n\nโพสต์:\nร่างมีอายุ 17 ปี\n\nจุดที่ไม่มีหรือไม่ตรงในข่าวดิบ:\n- "อายุ 17 ปี" (ดิบไม่บอกอายุ)`);
  assert.equal(w.calls[1].feature, 'f2xFactFix');
  assert.equal(c.calls.length, 2, 'ตรวจซ้ำหลังแก้ 1 ครั้ง');
  assert.equal(c.calls[1].user, `=== ข่าวดิบ ===
${RAW.trim()}

=== โพสต์ ===
ร่างแก้แล้ว
=== จบ ===`);
});

test('B3 ผลตรวจไม่ครบ/ตรวจล้ม/นักเขียนล้ม/ได้ว่าง/ดิบสั้น = โยน (ห้ามส่งฉบับที่ไม่ผ่านการตรวจ)', async () => {
  const ok = draftWriter(['ร่าง']).fn;
  await assert.rejects(F.writeF2xVersion({ rawText: RAW, callWriter: ok, callChecker: async () => ({}), pool: POOL }), /ผลตรวจข้อเท็จจริงไม่ครบ/);
  await assert.rejects(F.writeF2xVersion({ rawText: RAW, callWriter: ok, callChecker: async () => { throw new Error('ตัวตรวจล่ม'); }, pool: POOL }), /ตัวตรวจล่ม/);
  await assert.rejects(F.writeF2xVersion({ rawText: RAW, callWriter: async () => { throw new Error('fable 529'); }, callChecker: checker([]).fn, pool: POOL }), /fable 529/);
  await assert.rejects(F.writeF2xVersion({ rawText: RAW, callWriter: draftWriter(['ร่าง', '   ']).fn, callChecker: checker([{ text: 'a', why: 'b', severity: 'หนัก' }]).fn, pool: POOL }), /ได้โพสต์ว่าง/);
  await assert.rejects(F.writeF2xVersion({ rawText: 'สั้น', callWriter: ok, callChecker: checker([]).fn, pool: POOL }), /สั้นเกินไป/);
});

test('B4 หมดเวลาต่อขั้น = โยนแม้ตัวเรียกไม่ฟัง signal · ตัวแม่ยกเลิก = ส่งต่อ signal ที่ถูกยกเลิก', async () => {
  const never = () => new Promise(() => {});
  await assert.rejects(F.writeF2xVersion({ rawText: RAW, callWriter: never, callChecker: checker([]).fn, pool: POOL, timeouts: { write: 30 } }), /เขียน หมดเวลา/);
  await assert.rejects(F.writeF2xVersion({ rawText: RAW, callWriter: draftWriter(['ร่าง']).fn, callChecker: never, pool: POOL, timeouts: { check: 30 } }), /ตรวจข้อเท็จจริง หมดเวลา/);
  const ac = new AbortController(); let seen = null;
  const p = F.writeF2xVersion({ rawText: RAW, signal: ac.signal, callWriter: (a) => { seen = a.signal; return never(); }, callChecker: checker([]).fn, pool: POOL });
  ac.abort(new Error('เส้นตายท่อ'));
  await assert.rejects(p, /เส้นตายท่อ/);
  assert.equal(seen.aborted, true);
});

test('B5 จัดหมวด: ล้ม/หมดเวลา = หมวดว่าง ไม่โยน · ตัวแม่ยกเลิก = โยน · effort low', async () => {
  let call = null;
  const okr = await F.classifyF2xGenre({ rawText: RAW, callChecker: async (a) => { call = a; return { genre: 'สู้ชีวิต', emotion: 'ซึ้ง' }; } });
  assert.deepEqual(okr, { genre: 'สู้ชีวิต', emotion: 'ซึ้ง', ok: true });
  assert.equal(call.effort, 'low'); assert.equal(call.user, F.f2xClassifyUser(RAW));
  const bad = await F.classifyF2xGenre({ rawText: RAW, callChecker: async () => { throw new Error('ล่ม'); } });
  assert.equal(bad.ok, false); assert.equal(bad.genre, '');
  const slow = await F.classifyF2xGenre({ rawText: RAW, callChecker: () => new Promise(() => {}), timeoutMs: 20 });
  assert.equal(slow.ok, false);
  const ac = new AbortController(); ac.abort(new Error('ยกเลิกงาน'));
  await assert.rejects(F.classifyF2xGenre({ rawText: RAW, signal: ac.signal, callChecker: () => new Promise(() => {}) }), /ยกเลิกงาน/);
});

test('C1 ต่อท่อ: สวิตช์+สาย TEXT · จัดหมวดเริ่มหลังข้อความดิบ · ลูปตัดมุมข้ามเฉพาะเปิดสวิตช์ · บล็อก F2X อยู่ก่อนรีเสิร์ชต่อมุม', () => {
  assert.ok(SRC.includes("const _f2xOn = isF2xWriterEnabled() && (detectedType === 'text' || detectedType === 'plain_text');"));
  assert.ok(SRC.indexOf('const _f2xGenrePromise') > SRC.indexOf('const writerRawSourceText'));
  assert.ok(SRC.indexOf('const _f2xGenrePromise') < SRC.indexOf('// === STEP 3: แตกประเด็น'));
  assert.ok(SRC.includes('for (let i = anglesToUse.length - 1; i >= 1 && !_f2xOn; i--) {'));
  const f2xAt = SRC.indexOf('      if (_f2xOn) {\n        const _f2xT0');
  assert.ok(f2xAt > 0 && f2xAt < SRC.indexOf('      // 1. Research for this angle'));
  assert.ok(SRC.includes('const _corrInput = _f2xOn ? allVersions.filter((version) => !version._f2x) : allVersions;'));
  assert.ok(SRC.includes("&& !(_f2xOn && finalVersions.every((version) => version._f2x))) {"));
});

// ── ท่อนจริง: บล็อกเขียนต่อมุม ──
const taskStart = SRC.indexOf('      if (_f2xOn) {\n        const _f2xT0');
const taskEnd = SRC.indexOf('      // 1. Research for this angle');
const taskBlock = SRC.slice(taskStart, taskEnd);
const runTask = new AsyncFunction('ctx', `
  const { _f2xOn, _f2xGenrePromise, writeF2xVersion, writerRawSourceText, stageSignal, count, newsData, angleObj, index, f2xPreset, F2X_PRESET_ID, rethrowPipelineDeadline, _f2xFallbacks, addLog, anglePrompts, MIN_ANGLE_MATCH } = ctx;
  ${taskBlock}
  return 'CONTINUE_OLD_WRITER';
`);
const taskCtx = (over = {}) => ({ _f2xOn: true, _f2xGenrePromise: Promise.resolve({ genre: 'สู้ชีวิต', ok: true }), writerRawSourceText: RAW, stageSignal: undefined, count: 1, newsData: { newsTitle: 'หัวข่าว' }, angleObj: { angle_name: 'มุมแรก' }, index: 0, f2xPreset: F.f2xPreset, F2X_PRESET_ID: F.F2X_PRESET_ID, rethrowPipelineDeadline: () => {}, _f2xFallbacks: [], logs: [], addLog(step, msg) { this.logs.push(`${step}: ${msg}`); }, anglePrompts: [{ _matchScore: 80 }, { _matchScore: 10 }], MIN_ANGLE_MATCH: 45, ...over });

test('C2 บล็อกมุม: สำเร็จ = ผลรูปเดียวกับ performSummarize (ผ่านสัญญา versions/usedModel/promptId) · ปิดสวิตช์ = เดินนักเขียนเดิม', async () => {
  const ctx = taskCtx({ writeF2xVersion: async () => ({ text: 'โพสต์ F2X', model: 'claude-fable-5-1', genre: 'สู้ชีวิต', exemplarIds: ['p1'], fixed: 1, heavyIssues: ['x'], lightIssues: 0 }) });
  ctx.addLog = ctx.addLog.bind(ctx);
  const r = await runTask(ctx);
  assert.equal(r.success, true);
  assert.equal(r.data.versions.length, 1);
  assert.deepEqual({ title: r.data.versions[0].title, content: r.data.versions[0].content, _f2x: r.data.versions[0]._f2x }, { title: 'หัวข่าว', content: 'โพสต์ F2X', _f2x: true });
  assert.equal(r.data.usedModel, 'claude-fable-5-1');
  assert.equal(r._topPrompt.id, 'f2x'); assert.equal(r.data.usedPreset.promptId, 'f2x');
  assert.deepEqual(r._researchItems, []);
  assert.ok(ctx.logs.some((l) => /F2X เขียนเสร็จ 1 ฉบับ · หมวด สู้ชีวิต · แก้จุดเกินดิบ 1 จุด/.test(l)));
  const off = taskCtx({ _f2xOn: false, writeF2xVersion: async () => { throw new Error('ห้ามเรียก'); } });
  assert.equal(await runTask(off), 'CONTINUE_OLD_WRITER');
  const two = taskCtx({ count: 2, writeF2xVersion: async () => ({ text: 't', model: 'claude-fable-5-1', genre: '', exemplarIds: [], fixed: 0, heavyIssues: [], lightIssues: 0 }) });
  two.addLog = two.addLog.bind(two);
  assert.equal((await runTask(two)).data.versions.length, 2, 'GEN_PER_ANGLE > 1 = ได้ครบจำนวน');
});

test('C3 บล็อกมุม: F2X ล้ม = ถอยนักเขียนเดิม + บันทึกเหตุ · มุม 2+ การ์ดหลวม = ตัดมุม ไม่ถอย · เส้นตาย = โยนต่อ', async () => {
  const fail = async () => { throw new Error('fable ล่ม'); };
  const a = taskCtx({ writeF2xVersion: fail }); a.addLog = a.addLog.bind(a);
  assert.equal(await runTask(a), 'CONTINUE_OLD_WRITER');
  assert.deepEqual(a._f2xFallbacks, [{ angle: 'มุมแรก', reason: 'fable ล่ม', dropped: false }]);
  const b = taskCtx({ writeF2xVersion: fail, index: 1, angleObj: { angle_name: 'มุมสอง' } }); b.addLog = b.addLog.bind(b);
  const rb = await runTask(b);
  assert.equal(rb.success, false); assert.match(rb.error, /การ์ดมุมนี้จับคู่หลวม/); assert.equal(rb._topPrompt, null);
  assert.equal(b._f2xFallbacks[0].dropped, true);
  const c = taskCtx({ writeF2xVersion: fail, index: 1, anglePrompts: [{ _matchScore: 80 }, { _matchScore: 10, _matchType: 'AI_PICKED' }] }); c.addLog = c.addLog.bind(c);
  assert.equal(await runTask(c), 'CONTINUE_OLD_WRITER', 'การ์ดที่ AI เลือกเอง = ถอยได้');
  const d = taskCtx({ writeF2xVersion: fail, rethrowPipelineDeadline: () => { throw new Error('PIPELINE_DEADLINE'); } });
  await assert.rejects(runTask(d), /PIPELINE_DEADLINE/);
});

// ── ท่อนจริง: correction + บก.เกลา ──
const corrStart = SRC.indexOf('  const applyCorrectionFallback = (corrected, originals, label = \'Correction\') => {');
const corrMid = SRC.indexOf('  // === POST-GENERATION CORRECTION PIPELINE ===');
const corrFrom = SRC.indexOf('  // ★ 29 ต.ค. 69 (F2X): ฉบับ F2X ตรวจแก้ข้อมูลเกินดิบในตัวแล้ว');
const corrTo = SRC.indexOf('  // ด่านสุดท้ายก่อนบันทึก: ข่าวจากข้อความดิบห้ามเขียนเหมือนไปยืนเห็นเอง');
const runCorr = new AsyncFunction('ctx', `
  const { _f2xOn, allVersions, runCorrectionPipeline, newsData, breakdownData, correctionResearchFacts, groundingSourceText, pipelineQualityWarnings, addLog, rethrowPipelineDeadline, _f2xFallbacks, logPipeline, _autoWorkflowId, isAdminVoiceEditEnabled, detectedType, runAdminVoiceEdit, rawText, anglePrompts, isRawFactCompletenessGateEnabled } = ctx;
  ${SRC.slice(corrStart, corrMid)}
  let finalVersions;
  ${SRC.slice(corrFrom, corrTo)}
  return finalVersions;
`);
const V = (id, extra = {}) => ({ title: 't' + id, content: 'c' + id, usedModel: 'm', _source: 'classic', _sourceLabel: 'a' + id, promptId: 'p' + id, ...extra });
const corrCtx = (over = {}) => {
  const ctx = { _f2xOn: true, allVersions: [], newsData: {}, breakdownData: {}, correctionResearchFacts: null, groundingSourceText: RAW, pipelineQualityWarnings: [], logs: [], pipelineLogs: [], rethrowPipelineDeadline: () => {}, _f2xFallbacks: [], _autoWorkflowId: 'wf', isAdminVoiceEditEnabled: () => true, detectedType: 'text', rawText: RAW, anglePrompts: [], isRawFactCompletenessGateEnabled: () => false, corrCalls: [], avCalls: [], ...over };
  ctx.addLog = (s, m) => ctx.logs.push(`${s}: ${m}`);
  ctx.logPipeline = async (row) => { ctx.pipelineLogs.push(row); };
  ctx.runCorrectionPipeline = ctx.runCorrectionPipeline || (async (list) => { ctx.corrCalls.push(list); return list.map((v) => ({ ...v, content: v.content + '+แก้', _correctionApplied: true })); });
  ctx.runAdminVoiceEdit = ctx.runAdminVoiceEdit || (async (list) => { ctx.avCalls.push(list); return { versions: list.map((v) => ({ ...v, content: v.content + '+เกลา' })), summaryLine: 'av', applied: true }; });
  return ctx;
};

test('C4 ปิดสวิตช์ = correction ได้ allVersions ตัวเดิม (reference เดียวกัน) · บก.เกลาได้ทุกฉบับ · ไม่มีแถว f2x-writer', async () => {
  const all = [V(1), V(2)];
  const ctx = corrCtx({ _f2xOn: false, allVersions: all });
  const out = await runCorr(ctx);
  assert.equal(ctx.corrCalls.length, 1); assert.equal(ctx.corrCalls[0], all);
  assert.equal(ctx.avCalls.length, 1); assert.equal(ctx.avCalls[0].length, 2);
  assert.deepEqual(out.map((v) => v.content), ['c1+แก้+เกลา', 'c2+แก้+เกลา']);
  assert.equal(ctx.pipelineLogs.filter((r) => r.step === 'f2x-writer').length, 0);
});

test('C5 เปิดสวิตช์ทุกฉบับ F2X = ไม่เรียก correction ไม่เรียก บก.เกลา · เนื้อเดิมทุกไบต์ · แถว f2x-writer success', async () => {
  const all = [V(1, { _f2x: true }), V(2, { _f2x: true })];
  const ctx = corrCtx({ allVersions: all });
  const out = await runCorr(ctx);
  assert.equal(ctx.corrCalls.length, 0); assert.equal(ctx.avCalls.length, 0);
  assert.deepEqual(out.map((v) => v.content), ['c1', 'c2']);
  assert.ok(out.every((v) => v._correctionApplied === false));
  assert.equal(ctx.pipelineLogs.find((r) => r.step === 'f2x-writer').status, 'success');
  assert.equal(ctx.pipelineQualityWarnings.length, 0);
});

test('C6 เปิดสวิตช์ผสม (มุมหนึ่งถอยนักเขียนเดิม) = correction/บก.เกลาเฉพาะฉบับเดิม · ลำดับมุมคงเดิม · เตือนพนักงาน + แถว fallback', async () => {
  const all = [V(1, { _f2x: true }), V(2)];
  const ctx = corrCtx({ allVersions: all, _f2xFallbacks: [{ angle: 'a2', reason: 'fable ล่ม', dropped: false }] });
  const out = await runCorr(ctx);
  assert.equal(ctx.corrCalls.length, 1); assert.deepEqual(ctx.corrCalls[0].map((v) => v.promptId), ['p2']);
  assert.equal(ctx.avCalls.length, 1); assert.deepEqual(ctx.avCalls[0].map((v) => v.promptId), ['p2']);
  assert.deepEqual(out.map((v) => v.content), ['c1', 'c2+แก้+เกลา']);
  assert.ok(ctx.pipelineQualityWarnings.some((w) => /F2X ล้ม 1 มุม — a2: ถอยไปนักเขียนเดิม \(fable ล่ม\)/.test(w)));
  assert.equal(ctx.pipelineLogs.find((r) => r.step === 'f2x-writer').status, 'fallback');
});

test('C7 เปิดสวิตช์ผสม + correction ล้มทั้งชุด = ฉบับเดิมของมุมนั้นพร้อมคำเตือน · ฉบับ F2X ไม่โดนแตะ', async () => {
  const all = [V(1), V(2, { _f2x: true })];
  const ctx = corrCtx({ allVersions: all, runCorrectionPipeline: async () => { throw new Error('correction ล่ม'); }, isAdminVoiceEditEnabled: () => false });
  const out = await runCorr(ctx);
  assert.deepEqual(out.map((v) => v.content), ['c1', 'c2']);
  assert.equal(out[0]._correctionApplied, false); assert.match(out[0]._correctionWarning, /Correction V1 ล้ม/);
  assert.equal(out[1]._f2x, true); assert.equal(out[1]._correctionWarning, undefined);
});

// ── รอบ 2 (ผู้ตรวจอิสระ 29 ต.ค. FAIL รอบ 1): ป้ายแปลก · ตรวจซ้ำหลังแก้ · คำนำ · คำเสี่ยง · ตัวอย่างคนเดียวกัน · งบเวลา · ตัวอ่านผล Fable ──
const SF = await jiti.import(`${ROOT}src/lib/ai/safetyFilter.js`);

test('A5 ตัดตัวอย่างที่มีชื่อเฉพาะเดียวกับข่าว (คำหายากในคลัง) · ข่าวไม่มีชื่อซ้ำ = ชุดเดิม', () => {
  const pool = [
    ...POOL,
    { id: 'p9', views: 9.5e6, genre: 'สู้ชีวิต', caption: 'ป้าเจี๊ยบทำงานกับชมพู่มา 15 ปี' },
    { id: 'p10', views: 4e6, genre: 'อื่นๆ', caption: 'อื่น 1' }, { id: 'p11', views: 3e6, genre: 'อื่นๆ', caption: 'อื่น 2' }, { id: 'p12', views: 2e6, genre: 'อื่นๆ', caption: 'อื่น 3' },
  ];
  assert.equal(F.pickF2xExemplars('สู้ชีวิต', 6, pool)[0].id, 'p9');
  const ids = F.pickF2xExemplars('สู้ชีวิต', 6, pool, { rawText: 'ชมพู่พาป้าเจี๊ยบไปเที่ยวต่างประเทศ' }).map((p) => p.id);
  assert.ok(!ids.includes('p9'), 'โพสต์ที่มีชื่อ ชมพู่/ป้าเจี๊ยบ ต้องถูกตัด');
  assert.deepEqual(F.pickF2xExemplars('สู้ชีวิต', 6, pool, { rawText: 'ข่าวทั่วไปไม่มีชื่อซ้ำ' }).map((p) => p.id), F.pickF2xExemplars('สู้ชีวิต', 6, pool).map((p) => p.id));
});

test('A6 ฉบับที่ 2 (variant 1) = ตัวอย่างชุดถัดไป ไม่ซ้ำชุดแรก · คลังไม่พอ = ใช้ชุดแรก', () => {
  const pool = [...POOL, ...Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, views: (4.9 - i * 0.1) * 1e6, genre: 'อื่นๆ', caption: `อื่น ${i}` }))];
  const a = F.pickF2xExemplars('สู้ชีวิต', 6, pool).map((p) => p.id);
  const b = F.pickF2xExemplars('สู้ชีวิต', 6, pool, { variant: 1 }).map((p) => p.id);
  assert.equal(b.length, 6); assert.ok(b.every((id) => !a.includes(id)), `${a} vs ${b}`);
  assert.deepEqual(b.slice(0, 1), ['p7'], 'ชุดถัดไปยังเริ่มจากหมวดเดียวกันที่เหลือ');
  assert.deepEqual(F.pickF2xExemplars('สู้ชีวิต', 6, POOL, { variant: 1 }).map((p) => p.id), F.pickF2xExemplars('สู้ชีวิต', 6, POOL).map((p) => p.id));
});

test('A7 ตัวอ่านผล Fable: ชนเพดาน/ปฏิเสธ = โยน · เอาเฉพาะบล็อกข้อความ · ว่าง = โยน', () => {
  assert.throws(() => F.readF2xWriterResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'ครึ่งๆ' }] }), /ไม่จบ \(max_tokens\)/);
  assert.throws(() => F.readF2xWriterResponse({ stop_reason: 'refusal', content: [] }), /ไม่จบ \(refusal\)/);
  assert.equal(F.readF2xWriterResponse({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: ' โพสต์ ' }] }), 'โพสต์');
  assert.throws(() => F.readF2xWriterResponse({ stop_reason: 'end_turn', content: [{ type: 'thinking' }] }), /ตอบว่าง/);
});

test('B6 ป้ายความหนักไม่ใช่ "เบา" ชัดๆ = ถือว่าหนัก (ส่งแก้ทุกกรณี) · "เบา" (มีช่องว่าง) = เบา', async () => {
  for (const sev of ['หนัก ', 'หนักมาก', 'heavy', 'สูง', undefined, '', 'HIGH']) {
    const w = draftWriter(['ร่างผิด', 'ร่างแก้แล้ว']);
    const c = checker((a) => (a.user.includes('ร่างแก้แล้ว') ? { issues: [] } : { issues: [{ text: 'จุดผิด', why: 'ไม่มีในดิบ', severity: sev }] }));
    const r = await F.writeF2xVersion({ rawText: RAW, callWriter: w.fn, callChecker: c.fn, pool: POOL });
    assert.equal(r.text, 'ร่างแก้แล้ว', `ป้าย ${JSON.stringify(sev)}`); assert.equal(r.fixed, 1);
  }
  const ws = draftWriter(['ร่างผิด', 'ร่างแก้แล้ว']);
  const cs = checker((a) => (a.user.includes('ร่างแก้แล้ว') ? { issues: [] } : { issues: ['ข้อความเปล่าไม่มีป้าย'] }));
  assert.equal((await F.writeF2xVersion({ rawText: RAW, callWriter: ws.fn, callChecker: cs.fn, pool: POOL })).fixed, 1, 'issue เป็นข้อความเปล่า = หนัก');
  assert.match(ws.calls[1].user, /- "ข้อความเปล่าไม่มีป้าย" \(\)/);
  const wl = draftWriter(['ร่าง']);
  assert.equal((await F.writeF2xVersion({ rawText: RAW, callWriter: wl.fn, callChecker: checker([{ text: 'x', why: 'y', severity: ' เบา ' }]).fn, pool: POOL })).fixed, 0);
  assert.equal(wl.calls.length, 1);
});

test('B7 ตรวจซ้ำหลังแก้: ยังเกินดิบ = โยน (ถอยนักเขียนเดิม) · ฉบับแก้สั้นผิดปกติ = โยน', async () => {
  const heavyAlways = checker([{ text: 'อายุ 17 ปี', why: 'ไม่มีในดิบ', severity: 'หนัก' }]);
  await assert.rejects(F.writeF2xVersion({ rawText: RAW, callWriter: draftWriter(['ร่างผิดยาวพอสมควร', 'ร่างที่แก้แล้วแต่ยังผิดอยู่']).fn, callChecker: heavyAlways.fn, pool: POOL }), /แก้แล้วยังเกินดิบ 1 จุด/);
  assert.equal(heavyAlways.calls.length, 2);
  await assert.rejects(F.writeF2xVersion({ rawText: RAW, callWriter: draftWriter(['ร่างยาวมากพอสมควรจนกว่าครึ่ง', 'สั้น']).fn, callChecker: checker([{ text: 'a', why: 'b', severity: 'หนัก' }]).fn, pool: POOL }), /ฉบับแก้สั้นผิดปกติ/);
});

test('B8 ตัดคำนำที่โมเดลแถม · บรรทัดแรกที่เป็นเนื้อข่าวจริงไม่ถูกตัด', async () => {
  assert.equal(F.stripF2xWrapper('นี่คือโพสต์ที่แก้แล้ว:\nเนื้อโพสต์\nบรรทัดสอง'), 'เนื้อโพสต์\nบรรทัดสอง');
  assert.equal(F.stripF2xWrapper('โพสต์ฉบับแก้:\n\nเนื้อ'), 'เนื้อ');
  assert.equal(F.stripF2xWrapper('```\nเนื้อ\n```'), 'เนื้อ');
  assert.equal(F.stripF2xWrapper('บุ๋มเล่าว่า:\n"เหนื่อยมาก"'), 'บุ๋มเล่าว่า:\n"เหนื่อยมาก"', 'บรรทัดแรกที่ไม่ใช่คำนำ = คงไว้');
  assert.equal(F.stripF2xWrapper('นี่คือความรักของแม่ที่ไม่มีวันหมด\nเนื้อ'), 'นี่คือความรักของแม่ที่ไม่มีวันหมด\nเนื้อ', 'ไม่จบด้วยโคลอน = คงไว้');
  const w = draftWriter(['ร่างผิดยาวพอสมควร', 'นี่คือโพสต์ที่แก้แล้ว:\nร่างแก้แล้วยาวพอสมควร']);
  const c = checker((a) => (a.user.includes('ร่างแก้แล้ว') ? { issues: [] } : { issues: [{ text: 'a', why: 'b', severity: 'หนัก' }] }));
  const r = await F.writeF2xVersion({ rawText: RAW, callWriter: w.fn, callChecker: c.fn, pool: POOL });
  assert.equal(r.text, 'ร่างแก้แล้วยาวพอสมควร');
  assert.ok(!c.calls[1].user.includes('นี่คือโพสต์ที่แก้แล้ว'), 'ตรวจซ้ำเห็นฉบับที่ตัดคำนำแล้ว');
});

test('B9 ฉบับ F2X ผ่านตัวกรองคำเสี่ยง Facebook ชุดเดียวกับนักเขียนหลัก (sanitizeOutput scope post)', async () => {
  const risky = 'ตำรวจพบศพผู้เสียหายในบ้าน ผู้ต้องหาฆ่าเหยื่อแล้วหลบหนี';
  const expected = String(SF.sanitizeOutput({ content: risky }, { scope: 'post' }).content).trim();
  assert.notEqual(expected, risky, 'ตัวกรองต้องเปลี่ยนคำเสี่ยงในประโยคทดสอบ');
  const r = await F.writeF2xVersion({ rawText: RAW, callWriter: draftWriter([risky]).fn, callChecker: checker([]).fn, pool: POOL });
  assert.equal(r.text, expected); assert.equal(r.sanitized, true);
  const plain = await F.writeF2xVersion({ rawText: RAW, callWriter: draftWriter(['โพสต์ปกติ']).fn, callChecker: checker([]).fn, pool: POOL });
  assert.equal(plain.sanitized, false);
});

test('B10 งบเวลารวมต่อฉบับ: เหลือน้อยกว่าขั้นต่ำก่อนขั้นถัดไป = โยน (ไม่เริ่มเรียก) · ค่าตั้งต้นตามแผน', async () => {
  let t = 0; const now = () => t;
  const w = { calls: 0, fn: async () => { w.calls++; t += 40; return 'ร่างผิดยาวพอสมควร'; } };
  const c = { calls: [], fn: async (a) => { c.calls.push(a); t += 30; return { issues: [{ text: 'a', why: 'b', severity: 'หนัก' }] }; } };
  await assert.rejects(F.writeF2xVersion({ rawText: RAW, callWriter: w.fn, callChecker: c.fn, pool: POOL, now, timeouts: { total: 100, minStep: 40 } }), /งบเวลาหมดก่อนขั้นแก้จุดเกินดิบ/);
  assert.equal(w.calls, 1, 'ไม่เริ่มขั้นแก้เมื่องบไม่พอ');
  assert.deepEqual({ ...F.F2X_TIMEOUTS }, { total: 170_000, write: 90_000, check: 45_000, fix: 60_000, recheck: 45_000, minStep: 10_000 });
});

test('C8 ต่อท่อรอบ 2: ส่ง signal ของมุม + variant ตามมุม · จัดหมวดรับสัญญาณเส้นตาย · บันทึก f2x ลง generation log · correction รายงาน skipped', async () => {
  assert.ok(SRC.includes('classifyF2xGenre({ rawText: writerRawSourceText, signal: getActivePipelineDeadline()?.signal })'));
  assert.ok(SRC.includes('f2x: _f2xOn ? { versions: finalVersions.map((version) => version._f2xMeta || null), fallbacks: _f2xFallbacks } : undefined,'));
  const logger = readFileSync(`${ROOT}src/lib/services/generationLogger.js`, 'utf8');
  assert.ok(logger.includes('...(pipelineInfo.f2x ? { f2x: pipelineInfo.f2x } : {}),'));
  const seen = [];
  for (const index of [0, 1]) {
    const sig = new AbortController().signal;
    const ctx = taskCtx({ index, stageSignal: sig, writeF2xVersion: async (a) => { seen.push(a); return { text: 'โพสต์', model: 'claude-fable-5-1', genre: '', variant: a.variant, exemplarIds: [], fixed: 0, heavyIssues: [], lightIssues: 0, sanitized: false }; } });
    ctx.addLog = ctx.addLog.bind(ctx);
    await runTask(ctx);
    assert.equal(seen.at(-1).signal, sig, 'ต้องส่ง stageSignal ของมุม');
    assert.equal(seen.at(-1).variant, index);
  }
  const loose0 = taskCtx({ index: 0, anglePrompts: [{ _matchScore: 5 }], writeF2xVersion: async () => { throw new Error('ล่ม'); } });
  loose0.addLog = loose0.addLog.bind(loose0);
  assert.equal(await runTask(loose0), 'CONTINUE_OLD_WRITER', 'มุมแรกการ์ดหลวมยังถอยได้ (มุมแรกเก็บเสมอ)');
  const empty = taskCtx({ newsData: { newsTitle: '' }, writeF2xVersion: async () => ({ text: 'บรรทัดแรก\nบรรทัดสอง', model: 'claude-fable-5-1', genre: '', variant: 0, exemplarIds: [], fixed: 0, heavyIssues: [], lightIssues: 0, sanitized: false }) });
  empty.addLog = empty.addLog.bind(empty);
  assert.equal((await runTask(empty)).data.versions[0].title, 'บรรทัดแรก', 'หัวข่าวว่าง = บรรทัดแรก');
  const cc = corrCtx({ allVersions: [V(1, { _f2x: true })] });
  assert.equal((await runCorr(cc))[0]._correctionSkipped, 'f2x');
});

// ── รอบ 3 (ผู้ตรวจอิสระ 29 ต.ค. รอบ 2 PASS มีเงื่อนไข): ด่านคำหายากไม่ตัดเกิน · จุดหนักช่องว่าง · คำนำ/ชื่อคน · promise จัดหมวด ──
test('A8 ข่าวดิบยาวหลายชื่อ (คลังจริง 63 ชิ้น): ตัดเฉพาะโพสต์ที่มีชื่อเดียวกัน · ตัวอย่างหมวดเดียวกันยังครบ 4 · ไม่ตัดเพราะคำธรรมดา', () => {
  const pool = F.loadF2xPool();
  const sources = pool.filter((p) => p.genre === 'น้ำดี').slice(0, 3);
  const longRaw = sources.map((p) => p.caption).join('\n\n') + '\nเหตุผล ฝ่าย ช่วงเวลา สามารถ โพสต์ ทำบุญ อนุโมทนา บวช';
  const picks = F.pickF2xExemplars('น้ำดี', 6, pool, { rawText: longRaw });
  assert.ok(picks.every((p) => !sources.includes(p)), 'โพสต์ต้นทางของชื่อในข่าวต้องถูกตัด');
  assert.ok(picks.filter((p) => p.genre === 'น้ำดี').length >= 4, 'หมวดเดียวกันต้องยังได้ 4 ชิ้น');
  const common = F.pickF2xExemplars('ศาสนา', 6, pool, { rawText: 'ญาติโยมมาทำบุญ อนุโมทนา บวช ที่วัด เหตุผล ฝ่าย สามารถ' });
  // คลังมีหมวดศาสนา 4 ชิ้น · เกณฑ์เดิม (≤3 โพสต์) ตัดหมดทั้ง 4 · เกณฑ์ใหม่ (1 โพสต์ ยาว ≥3) ยอมเสียได้อย่างมาก 1 (คำที่บังเอิญเจอโพสต์เดียว)
  assert.ok(common.filter((p) => p.genre === 'ศาสนา').length >= 3, `คำธรรมดาของหมวดศาสนาต้องไม่ทำให้ตัวอย่างหาย (${common.map((p) => p.genre).join(',')})`);
});

test('B11 จุดหนักที่ช่องข้อความว่าง/ใช้ชื่อช่องอื่น/มีแค่ป้าย = ยังส่งแก้ (ใช้ข้อความจากช่องที่มี)', async () => {
  for (const issue of [{ text: '', why: 'เติมอายุ 17 ปี', severity: 'หนัก' }, { claim: 'อายุ 17 ปี', severity: 'หนัก' }, { severity: 'หนัก' }]) {
    const w = draftWriter(['ร่างผิดยาวพอสมควร', 'ร่างแก้แล้วยาวพอสมควร']);
    const c = checker((a) => (a.user.includes('ร่างแก้แล้ว') ? { issues: [] } : { issues: [issue] }));
    const r = await F.writeF2xVersion({ rawText: RAW, callWriter: w.fn, callChecker: c.fn, pool: POOL });
    assert.equal(r.fixed, 1, JSON.stringify(issue)); assert.equal(w.calls.length, 2);
  }
  assert.deepEqual(F.splitF2xIssues([{ text: '', why: 'เติมอายุ', severity: 'หนัก' }]).heavy.length, 1);
  assert.equal(F.f2xFixUser('ดิบ', 'โพสต์', [{ text: '', why: 'เติมอายุ 17 ปี', severity: 'หนัก' }]).split('\n').at(-1), '- "เติมอายุ 17 ปี" (เติมอายุ 17 ปี)');
});

test('B12 คำนำ: ตัดเฉพาะบรรทัดที่บอกว่าแก้/ปรับแล้ว หรือ "Here is" · ชื่อคน/เนื้อข่าวที่จบโคลอนต้องคงไว้ · ตัดบนร่างแรกด้วย', async () => {
  assert.equal(F.stripF2xWrapper('แก้วตา ภรรยาผู้เสียชีวิต เล่าทั้งน้ำตา:\n"ขอบคุณทุกคน"'), 'แก้วตา ภรรยาผู้เสียชีวิต เล่าทั้งน้ำตา:\n"ขอบคุณทุกคน"');
  assert.equal(F.stripF2xWrapper('โพสต์ล่าสุดของแม่น้องพายุ:\n"คิดถึงลูก"'), 'โพสต์ล่าสุดของแม่น้องพายุ:\n"คิดถึงลูก"');
  assert.equal(F.stripF2xWrapper('Here is the revised post:\nเนื้อ'), 'เนื้อ');
  assert.equal(F.stripF2xWrapper('ด้านล่างคือโพสต์ที่ปรับแล้ว:\nเนื้อ'), 'เนื้อ');
  const w = draftWriter(['Here is the post:\nร่างแรกเนื้อจริง']);
  const c = checker([]);
  const r = await F.writeF2xVersion({ rawText: RAW, callWriter: w.fn, callChecker: c.fn, pool: POOL });
  assert.equal(r.text, 'ร่างแรกเนื้อจริง'); assert.ok(!c.calls[0].user.includes('Here is'), 'ตัวตรวจเห็นร่างที่ตัดคำนำแล้ว');
});

test('C9 promise จัดหมวดมีตัวรับ error ทันทีที่สร้าง (งานล้มก่อนขั้นเขียน = ไม่มี unhandled rejection)', async () => {
  const at = SRC.indexOf('const _f2xGenrePromise = _f2xOn ?');
  const next = SRC.indexOf('\n', at);
  assert.ok(SRC.slice(next + 1, SRC.indexOf('\n', next + 1)).trim().startsWith('_f2xGenrePromise?.catch(() => {});'));
  const seen = [];
  const onUnhandled = (e) => seen.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const ac = new AbortController();
    const p = F.classifyF2xGenre({ rawText: RAW, signal: ac.signal, callChecker: () => new Promise(() => {}) });
    p?.catch(() => {});
    ac.abort(new Error('งานจบก่อน'));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(seen.length, 0);
    await assert.rejects(p, /งานจบก่อน/, 'ผู้รอจริงยังได้ error เดิม');
  } finally { process.off('unhandledRejection', onUnhandled); }
});

// ── รอบ 4 (ผู้ตรวจอิสระ 29 ต.ค. รอบ 3 PASS มีเงื่อนไข): ข่าวดิบยาวมาก = ผ่อนทีละขั้น แต่โพสต์ชื่อซ้ำมากสุดถูกตัดเสมอ + ธงตรวจย้อน ──
test('A9 ตัดแล้วเหลือน้อย: ผ่อนเกณฑ์ทีละขั้น · โพสต์ที่ชื่อซ้ำกับข่าวมากที่สุดยังถูกตัด · ติดธง guardRelaxed', () => {
  const names = ['สมศักดิ์', 'สมหญิง', 'มาลัยพร', 'ประเสริฐ', 'วิมลรัตน์', 'ธนาธิป', 'กาญจนา', 'บุญเลิศ'];
  const pool = [
    ...names.map((nm, i) => ({ id: `s${i}`, views: (9 - i * 0.2) * 1e6, genre: 'น้ำดี', caption: `เรื่องของ${nm} ที่ทำความดี` })),
    { id: 'same', views: 9.9e6, genre: 'น้ำดี', caption: 'ป้าเจี๊ยบทำงานกับชมพู่มา 15 ปี เมลเบิร์น' },
    { id: 'c1', views: 4e6, genre: 'อื่นๆ', caption: 'ข่าวทั่วไปหนึ่ง' }, { id: 'c2', views: 3e6, genre: 'อื่นๆ', caption: 'ข่าวทั่วไปสอง' }, { id: 'c3', views: 2e6, genre: 'อื่นๆ', caption: 'ข่าวทั่วไปสาม' },
  ];
  const raw = `${names.join(' ')} และ ป้าเจี๊ยบ ชมพู่ เมลเบิร์น`;
  const info = {};
  const picks = F.pickF2xExemplars('น้ำดี', 6, pool, { rawText: raw, info });
  assert.ok(!picks.some((p) => p.id === 'same'), 'โพสต์ที่ชื่อซ้ำมากที่สุด (3 ชื่อ) ต้องถูกตัดเสมอ');
  assert.equal(info.guardRelaxed, true); assert.ok(info.usable >= 6);
  const plain = {};
  F.pickF2xExemplars('น้ำดี', 6, pool, { rawText: 'ข่าวไม่มีชื่อซ้ำ', info: plain });
  assert.equal(plain.guardRelaxed, false);
});

test('A10 ผ่อนจนสุดแล้วยังไม่ครบ = ตัดแค่กลุ่มชื่อซ้ำมากสุด (ได้ตัวอย่างครบ 6 เสมอ ไม่ว่าง)', () => {
  const zNames = ['กิตติพงษ์', 'วรรณภา', 'ชัยวัฒน์', 'ศิริพร', 'อนุชิต'];
  const pool = [
    { id: 'same', views: 9.9e6, genre: 'น้ำดี', caption: 'ป้าเจี๊ยบ ชมพู่ เมลเบิร์น' },
    { id: 'two1', views: 9e6, genre: 'น้ำดี', caption: 'สมศักดิ์ สมหญิง' }, { id: 'two2', views: 8e6, genre: 'น้ำดี', caption: 'มาลัยพร ประเสริฐ' },
    ...zNames.map((nm, i) => ({ id: 'z' + i, views: (5 - i * 0.1) * 1e6, genre: 'อื่นๆ', caption: 'เรื่องของ ' + nm })),
  ];
  const raw = ['ป้าเจี๊ยบ ชมพู่ เมลเบิร์น', 'สมศักดิ์ สมหญิง มาลัยพร ประเสริฐ', ...zNames].join(' ');
  const info = {};
  const picks = F.pickF2xExemplars('น้ำดี', 6, pool, { rawText: raw, info });
  assert.equal(picks.length, 6, 'ต้องได้ครบ 6');
  assert.ok(!picks.some((p) => p.id === 'same'), 'กลุ่มชื่อซ้ำมากสุดถูกตัดเสมอ');
  assert.equal(info.guardRelaxed, true);
});
