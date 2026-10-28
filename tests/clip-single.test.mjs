/**
 * ★ 25 ต.ค. 69 เฟส 1 — เครื่องยนต์ "เนื้อข่าวช่องเดียว" (clipSingle)
 *   แผนช่วงดูครบ · เลื่อนเวลาเป็นเวลาจริง · ตัวตรวจด้วยโค้ด (คำพูด/ชื่อ/ตัวเลข/ความครบ/เพศ/ช่วงที่หาย)
 *   · ท่อหลักกับตัวแทน (ไม่ยิง AI จริง) · คนเขียนสองค่าย
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { planSegments, normalizeWatch, parseClock, formatClock } from '../src/lib/services/clipSingle/segments.js';
import {
  checkSingleBody, bestMatch, normalize, numbersIn, parseThaiNumberWords, nameTokens, extractQuotes, clockHours, isPromoPoint, maybePromoPoint,
} from '../src/lib/services/clipSingle/check.js';
import { runClipSinglePipeline, INLINE_CAP } from '../src/lib/services/clipSingle/pipeline.js';
import { resolveWriter, validateDraft, writeSingleBody } from '../src/lib/services/clipSingle/writer.js';
import { buildWatchPrompt, buildWriterPrompt, SINGLE_WRITER_SYSTEM } from '../src/lib/services/clipSingle/prompts.js';

// ★ 28 ต.ค. 69: ค่าเริ่มต้นเปลี่ยนเป็นร้อยแก้วกระชับ — ไฟล์นี้คุมทางเดิม (สวิตช์ถอย CLIP_RAW_STYLE=full)
//   ทางใหม่อยู่ใน tests/clip-concise.test.mjs (node --test แยกโปรเซสต่อไฟล์ ค่า env นี้ไม่รั่วข้ามไฟล์)
process.env.CLIP_RAW_STYLE = 'full';

const seg = (over = {}) => ({ no: 1, startSec: 0, endSec: 120, ok: true, transcript: [], screen: [], visuals: [], keyPoints: [], ...over });

test('planSegments: สั้นดูรอบเดียว · ยาวแบ่งช่วงต่อกันไม่มีช่องว่าง · มีเพดานจำนวนช่วง', () => {
  assert.deepEqual(planSegments(0), []);
  assert.deepEqual(planSegments(300), [{ no: 1, startSec: 0, endSec: 300 }]);
  assert.deepEqual(planSegments(480), [{ no: 1, startSec: 0, endSec: 480 }]);
  const p = planSegments(1500);
  assert.equal(p.length, 5);
  assert.equal(p[0].startSec, 0);
  assert.equal(p.at(-1).endSec, 1500);
  for (let i = 1; i < p.length; i += 1) assert.equal(p[i].startSec, p[i - 1].endSec, 'ช่วงต้องต่อกันพอดี ไม่มีช่องว่าง');
  const long = planSegments(3 * 3600);
  assert.equal(long.length, 24, 'คลิป 3 ชม. ไม่เกินเพดาน 24 ช่วง');
  assert.equal(long.at(-1).endSec, 10800);
});

test('normalizeWatch: เลื่อนเวลาเป็นเวลาจริงของคลิปเต็ม · ทิ้งแถวว่าง · อ่านความยาว', () => {
  const w = normalizeWatch({
    durationSec: 95.4,
    transcript: [{ t: '1:05', speaker: 'ผู้พูด 1', text: ' สวัสดีครับ ' }, { t: '1:10', speaker: 'x', text: '' }, 'คำพูดเปล่า'],
    screen: [{ t: '0:02', text: 'นายสมชาย ใจดี' }],
    visuals: ['ชายยกมือไหว้', ''],
    keyPoints: ['ประเด็น A'],
  }, { offsetSec: 360 });
  assert.equal(w.transcript.length, 2);
  assert.equal(w.transcript[0].t, '7:05');
  assert.equal(w.transcript[0].text, 'สวัสดีครับ');
  assert.equal(w.screen[0].t, '6:02');
  assert.deepEqual(w.visuals, ['ชายยกมือไหว้']);
  assert.equal(w.durationSec, 95);
  assert.equal(parseClock('1:02:03'), 3723);
  assert.equal(formatClock(3723), '1:02:03');
});

test('ตัวอ่านตัวเลข: เลขไทย · คำอ่าน · หน่วยพัน/ล้าน', () => {
  assert.equal(parseThaiNumberWords('หนึ่งล้านห้าแสน'), 1500000);
  assert.equal(parseThaiNumberWords('ยี่สิบห้า'), 25);
  assert.equal(parseThaiNumberWords('สิบเอ็ด'), 11);
  assert.equal(parseThaiNumberWords('สามร้อย'), 300);
  assert.equal(parseThaiNumberWords('ล้าน'), 1000000);
  const s = numbersIn('ได้เงิน ๑,๒๐๐ บาท และอีก 1.5 ล้าน กับสามร้อยคน');
  for (const v of ['1200', '1.5', '1500000', '300']) assert.ok(s.has(v), `ต้องอ่านได้ ${v}`);
});

test('ชื่อ: ลอกคำนำหน้าและคำบทบาท (บทเรียนด่านเดิมตีคำบทบาทว่าชื่อแต่ง)', () => {
  assert.deepEqual(nameTokens('นายสมชาย ใจดี'), ['สมชาย', 'ใจดี']);
  assert.deepEqual(nameTokens('ลูกสาวเจ้าของร้าน'), []);
  assert.deepEqual(nameTokens('ผู้ดำเนินรายการ'), []);
  assert.deepEqual(nameTokens('น้องข้าวหอม'), ['ข้าวหอม']);
});

test('bestMatch: ตรงเป๊ะ = 1 · พิมพ์ผิด 1–2 ตัวยังเจอ · ไม่มีในบทถอด = ต่ำ', () => {
  const t = normalize('วันนี้ผมอยากจะบอกว่า ผมไม่ยอมแพ้ แน่นอน และจะสู้ต่อไปจนถึงที่สุด');
  assert.equal(bestMatch(normalize('ผมไม่ยอมแพ้ แน่นอน'), t).score, 1);
  assert.ok(bestMatch(normalize('จะสู้ต่อไปจนถืงที่สุด'), t).score >= 0.9);
  assert.ok(bestMatch(normalize('ผมจะลาออกจากตำแหน่งทันที'), t).score < 0.6);
});

test('checkSingleBody: แก้คำพูดที่ใกล้มาก · ติดธงคำพูดที่ไม่มีจริง · ชื่อ · ตัวเลข · ความครบ · เพศ · ช่วงที่หาย', () => {
  const segments = [
    seg({
      no: 1, startSec: 0, endSec: 300,
      transcript: [
        { t: '0:10', speaker: 'สมชาย', text: 'ผมขายก๋วยเตี๋ยวมาสามสิบปี ไม่เคยคิดว่าจะมีวันนี้' },
        { t: '0:40', speaker: 'สมชาย', text: 'เงินที่ได้มาหนึ่งล้านห้าแสน จะเอาไปสร้างโรงเรียนให้เด็กๆ ครับ' },
      ],
      screen: [{ t: '0:05', text: 'นายสมชาย ใจดี เจ้าของร้านก๋วยเตี๋ยว' }],
      keyPoints: ['สมชายขายก๋วยเตี๋ยวมานาน 30 ปี', 'บริจาคเงินสร้างโรงเรียนให้เด็กในหมู่บ้านห่างไกล'],
    }),
    seg({ no: 2, startSec: 300, endSec: 600, ok: false }),
  ];
  const draft = {
    headline: 'สมชาย ใจดี เจ้าของร้านก๋วยเตี๋ยว 30 ปี บริจาค 1.5 ล้าน สร้างโรงเรียน',
    body: 'นายสมชาย ใจดี เจ้าของร้านก๋วยเตี๋ยว บริจาคเงิน 1.5 ล้านบาทเพื่อสร้างโรงเรียน โดยบอกว่า “ผมขายก๋วยเตี๋ยวมาสามสิบปี ไม่เคยคิดว่าจะมีวันน้”\n\nเธอยังบอกว่า “ผมจะลงสมัคร ส.ส. ปีหน้า” และมีคนมาช่วย 45 คน',
    names: ['นายสมชาย ใจดี', 'มดดำ คชาภา ตันเจริญ', 'ลูกสาวเจ้าของร้าน'],
  };
  const r = checkSingleBody(draft, { segments, caption: '' });
  assert.ok(r.body.includes('“ผมขายก๋วยเตี๋ยวมาสามสิบปี ไม่เคยคิดว่าจะมีวันนี้”'), 'คำพูดพิมพ์ผิด 1 ตัวต้องถูกแทนด้วยคำจริงจากบทถอด');
  const kinds = (k) => r.checks.filter((c) => c.kind === k);
  assert.equal(kinds('quote').filter((c) => c.level === 'fixed').length, 1);
  assert.ok(kinds('quote').some((c) => c.level === 'check' && c.text.includes('ลงสมัคร')), 'คำพูดที่ไม่มีในคลิปต้องขึ้นจุดเช็ค');
  assert.ok(kinds('name').some((c) => c.text.includes('ตันเจริญ')), 'ชื่อที่ไม่มีในคลิปต้องขึ้นจุดเช็ค');
  assert.ok(!kinds('name').some((c) => c.text.includes('สมชาย')), 'ชื่อที่ขึ้นจอแล้วต้องไม่ถูกตีผิด');
  assert.ok(!kinds('name').some((c) => c.text.includes('ลูกสาว')), 'คำบทบาทต้องไม่ถูกตีว่าชื่อแต่ง');
  assert.ok(kinds('number').some((c) => c.text.includes('"45"')), 'ตัวเลขที่ไม่มีในคลิปต้องขึ้นจุดเช็ค');
  assert.ok(!kinds('number').some((c) => c.text.includes('1.5')), '1.5 ล้าน = หนึ่งล้านห้าแสน ต้องผ่าน');
  assert.ok(!kinds('number').some((c) => c.text.includes('"30"')), '30 = สามสิบ ต้องผ่าน');
  assert.ok(kinds('gender').length === 1, 'ใช้ "เธอ" ทั้งที่คลิปไม่บอกเพศ ต้องขึ้นจุดเช็ค');
  assert.ok(kinds('segment').some((c) => c.text.includes('5:00–10:00')), 'ช่วงที่ดูไม่สำเร็จต้องขึ้นจุดเช็ค');
  assert.equal(kinds('coverage').length, 0, 'ประเด็นที่เขียนถึงแล้ว (แม้ใช้คำไม่ครบ) ต้องไม่ถูกตีว่าหาย');
});

test('checkSingleBody: ประเด็นที่ไม่ถูกเขียนถึงเลยต้องขึ้นจุดเช็ค · คำว่าเธอผ่านเมื่อคลิปบอกเพศ', () => {
  const segments = [seg({
    transcript: [{ speaker: 'ผู้พูด 1', text: 'หนูเปิดร้านกาแฟเล็กๆ ในซอยค่ะ ลูกค้าส่วนใหญ่เป็นนักศึกษา' }],
    keyPoints: ['เปิดร้านกาแฟเล็กในซอยลูกค้าเป็นนักศึกษา', 'ร้านถูกน้ำท่วมเสียหายหนักเมื่อปีก่อนต้องปิดซ่อมหลายเดือน'],
  })];
  const r = checkSingleBody({ headline: 'ร้านกาแฟในซอย', body: 'เธอเปิดร้านกาแฟเล็กๆ ในซอย ลูกค้าส่วนใหญ่เป็นนักศึกษา', names: [] }, { segments });
  assert.ok(r.checks.some((c) => c.kind === 'coverage' && c.text.includes('น้ำท่วม')));
  assert.ok(!r.checks.some((c) => c.kind === 'coverage' && c.text.includes('ร้านกาแฟเล็ก')));
  assert.ok(!r.checks.some((c) => c.kind === 'gender'), 'คลิปมี "ค่ะ" = บอกเพศแล้ว');
});

test('extractQuotes: เครื่องหมายไทย/อังกฤษ · ข้ามคำพูดสั้นเกินตรวจ', () => {
  const q = extractQuotes('เขาบอกว่า “ไม่ยอมแพ้แน่นอน” และ "สู้ต่อไป" แต่ “ใช่”');
  assert.deepEqual(q.map((x) => x.inner), ['ไม่ยอมแพ้แน่นอน', 'สู้ต่อไป']);
});

test('prompts: คำสั่งดูคลิปบอกช่วงเวลาและฐานเวลา · คำสั่งเขียนมีกฎเจ้าของครบ', () => {
  const w = buildWatchPrompt({ segment: { no: 2, startSec: 360, endSec: 720 }, total: 4, timeBase: 'file', wantDuration: false, caption: 'คลิปลุงสมชาย' });
  assert.ok(w.includes('ช่วงที่ 2 จาก 4') && w.includes('6:00–12:00') && w.includes('ต้นไฟล์วิดีโอ') && w.includes('คลิปลุงสมชาย'));
  assert.ok(!w.includes('durationSec'));
  assert.ok(buildWatchPrompt({ wantDuration: true }).includes('durationSec'));
  const p = buildWriterPrompt({ platform: 'tiktok', durationSec: 95, caption: '', transcriptBlock: '[ทั้งคลิป]\nผู้พูด 1: สวัสดี' });
  for (const rule of ['ห้ามเดาเพศ', 'ห้ามเปิดด้วยการบอกว่าใครมาออกรายการ', 'ตัดชื่อรายการ', '“ ”', 'ยาวตามเนื้อหาจริง', 'ขึ้นต้นด้วยตัวข่าว']) {
    assert.ok(p.includes(rule), `คำสั่งเขียนต้องมีกฎ: ${rule}`);
  }
});

test('writer: เลือกค่ายจาก env · ตรวจผล · Gemini/Claude ผ่านตัวแทน', async () => {
  const old = process.env.CLIP_WRITER_MODEL;
  try {
    delete process.env.CLIP_WRITER_MODEL;
    assert.deepEqual(resolveWriter(), { kind: 'gemini', model: 'gemini-3.8-flash', effort: 'high' });
    process.env.CLIP_WRITER_MODEL = 'claude-opus-4-8';
    assert.equal(resolveWriter().kind, 'claude');
  } finally { if (old === undefined) delete process.env.CLIP_WRITER_MODEL; else process.env.CLIP_WRITER_MODEL = old; }
  assert.equal(validateDraft({ headline: '', body: 'x' }).ok, false);
  assert.equal(validateDraft({ headline: 'ห', body: '' }).ok, false);
  const g = await writeSingleBody({ prompt: 'p', writer: { kind: 'gemini', model: 'gemini-3.8-flash', effort: 'high' },
    deps: { runBrain: async (o) => ({ ok: true, json: { headline: 'พาดหัว', body: 'เนื้อ\n\n\n\nย่อหน้าสอง', names: ['ก', 3] }, model: o.model, tokensUsed: 10 }) } });
  assert.equal(g.ok, true);
  assert.equal(g.draft.body, 'เนื้อ\n\nย่อหน้าสอง');
  assert.deepEqual(g.draft.names, ['ก']);
  let sent;
  const c = await writeSingleBody({ prompt: 'p', writer: { kind: 'claude', model: 'claude-opus-4-8', effort: 'medium' },
    deps: { callClaude: async (o) => { sent = o; return { headline: 'ห', body: 'บ', names: [] }; } } });
  assert.equal(c.ok, true);
  assert.equal(sent.systemPrompt, SINGLE_WRITER_SYSTEM, 'ต้องทับกฎกลาง "เล่าให้เพื่อนฟัง" ด้วย system ของข่าวทางการ');
  const bad = await writeSingleBody({ prompt: 'p', writer: { kind: 'gemini', model: 'gemini-3.8-flash' }, deps: { runBrain: async () => ({ ok: false, errorType: 'BRAIN_TIMEOUT', error: 'หมดเวลา' }) } });
  assert.equal(bad.ok, false);
  assert.equal(bad.errorType, 'BRAIN_TIMEOUT');
});

// ── ท่อหลักกับตัวแทน ──
function fakeVideo(script = {}) {
  const calls = [];
  const fn = async (opts) => {
    calls.push(opts);
    const i = calls.length;
    if (script.fail?.(opts, i)) return { ok: false, errorType: 'BUSY', error: 'แน่น', receipt: { elapsedMs: 5 } };
    await opts.onUsage?.({ inputTokens: 100, outputTokens: 50, totalTokens: 150, model: 'gemini-3.7-flash' });
    return {
      ok: true,
      receipt: { elapsedMs: 10, model: 'gemini-3.7-flash' },
      data: script.data?.(opts, i) || { transcript: [{ t: '0:30', speaker: 'ผู้พูด 1', text: `คำพูดช่วง ${i} ผมจะสู้ต่อไปจนถึงที่สุด` }], keyPoints: [`ประเด็นที่ ${i}`] },
    };
  };
  fn.calls = calls;
  return fn;
}
const fakeWriter = (draft = { headline: 'พาดหัว', body: 'เนื้อข่าว “ผมจะสู้ต่อไปจนถืงที่สุด” จบ', names: [] }) => {
  const fn = async (o) => { fn.prompt = o.prompt; return { ok: true, draft, model: 'gemini-3.8-flash', kind: 'gemini', elapsedMs: 3, tokensUsed: 1000 }; };
  return fn;
};
const buf = (n) => Buffer.alloc(n, 1);

test('pipeline: คลิปสั้นดูรอบเดียว → เขียน → ตรวจ (แก้คำพูด) · rawData = body', async () => {
  const video = fakeVideo();
  const writer = fakeWriter();
  const r = await runClipSinglePipeline({ url: 'https://vt.tiktok.com/x/', type: 'tiktok', videoBuffer: buf(50_000), durationSec: 60, deps: { callVideo: video, writeSingleBody: writer } });
  assert.equal(r.ok, true);
  assert.equal(video.calls.length, 1);
  assert.ok(video.calls[0].videoBuffer);
  assert.equal(r.insight.engine, 'clip-single');
  assert.equal(r.insight.rawData, r.insight.body);
  assert.ok(r.insight.body.includes('“คำพูดช่วง 1 ผมจะสู้ต่อไปจนถึงที่สุด”') || r.insight.body.includes('จนถึงที่สุด'), 'คำพูดต้องถูกแก้ให้ตรงบทถอด');
  assert.ok(r.insight.checks.some((c) => c.level === 'fixed'));
  assert.equal(r.insight.clipDurationSec, 60);
  assert.ok(writer.prompt.includes('คำพูดช่วง 1'), 'คนเขียนต้องได้บทถอด');
  assert.ok(r.spentTokens >= 1150, 'นับ token ทั้งดูคลิปและเขียน');
  assert.equal(r.insight.single.segments.length, 1);
});

test('pipeline: คลิปยาว → ผ่าไฟล์ทุกช่วง · ช่วงที่ผ่าไม่สำเร็จขึ้นจุดเช็ค · เวลาเลื่อนเป็นเวลาจริง', async () => {
  const video = fakeVideo();
  let cutPlan;
  const cut = async (b, plan) => { cutPlan = plan; return { ok: false, errorType: 'SEG_INCOMPLETE', segments: plan.filter((s) => s.no !== 3).map((s) => ({ ...s, buffer: buf(20_000) })), warnings: ['ท่อน 3: ผ่าไม่สำเร็จ'] }; };
  const r = await runClipSinglePipeline({ url: 'https://www.facebook.com/x', type: 'meta', videoBuffer: buf(30_000), durationSec: 1500,
    deps: { callVideo: video, writeSingleBody: fakeWriter(), cutSegments: cut, hasFfmpeg: async () => true } });
  assert.equal(r.ok, true);
  assert.equal(cutPlan.length, 5);
  assert.equal(video.calls.length, 4, 'ช่วงที่ผ่าไม่สำเร็จไม่ต้องยิง Gemini');
  assert.ok(r.insight.checks.some((c) => c.kind === 'segment' && c.text.includes('10:00–15:00')));
  const t = r.transcriptText;
  assert.ok(t.includes('(5:30)'), 'ช่วงที่ 2 เริ่ม 5:00 · คำพูดที่ 0:30 ของไฟล์ท่อน = 5:30 ของคลิปเต็ม');
  assert.ok(t.includes('(20:30)'), 'ช่วงที่ 5 เริ่ม 20:00 → 20:30');
});

test('pipeline: YouTube ยาวใช้ลิงก์ + ช่วงเวลา ไม่ผ่าไฟล์', async () => {
  const video = fakeVideo();
  const r = await runClipSinglePipeline({ url: 'https://www.youtube.com/watch?v=abcdefghijk', type: 'youtube', durationSec: 1000, deps: { callVideo: video, writeSingleBody: fakeWriter() } });
  assert.equal(r.ok, true);
  assert.equal(video.calls.length, 3);
  assert.deepEqual(video.calls.map((c) => c.videoRange), [[0, 333], [333, 667], [667, 1000]]);
  assert.ok(video.calls.every((c) => c.youtubeUrl && !c.videoBuffer));
  assert.equal(r.insight.single.transcriptText, undefined, 'ห้ามเก็บบทถอดเต็มในผลที่ลงคลัง');
  assert.ok(r.transcriptText.includes('คำพูดช่วง'), 'บทถอดส่งคืนนอก insight สำหรับผู้เรียกที่ต้องการ');
});

test('pipeline: YouTube ไม่รู้ความยาว = ถามความยาวแบบคำตอบสั้นก่อน แล้วแบ่งช่วง (ห้ามถอดทั้งคลิปรวดเดียว)', async () => {
  const v2 = fakeVideo({ data: (opts, i) => (i === 1 ? { durationSec: 1500 } : { transcript: [{ speaker: 'ผู้พูด 1', text: `เนื้อช่วงที่ ${i} สวัสดีครับ วันนี้มาเล่าเรื่องร้านกาแฟ` }], keyPoints: [] }) });
  const r2 = await runClipSinglePipeline({ url: 'https://www.youtube.com/watch?v=abcdefghijk', type: 'youtube', durationSec: 0, deps: { callVideo: v2, writeSingleBody: fakeWriter() } });
  assert.equal(r2.ok, true);
  assert.ok(v2.calls[0].maxTokens <= 4000 && !v2.calls[0].videoRange && /ความยาวคลิป/.test(v2.calls[0].prompt), 'ครั้งแรกต้องเป็นคำถามความยาว (เพดานคำตอบเล็กกว่าการถอดมาก)');
  assert.equal(v2.calls.length, 1 + 5, 'ได้ 1500 วิ → ดูต่อ 5 ช่วง');
  assert.ok(v2.calls.slice(1).every((c) => Array.isArray(c.videoRange)), 'ช่วงที่ดูจริงต้องมีกรอบเวลา');
  assert.equal(r2.insight.clipDurationSec, 1500);

  const v3 = fakeVideo({ fail: (opts, i) => i === 1 });
  const r3 = await runClipSinglePipeline({ url: 'https://www.youtube.com/watch?v=abcdefghijk', type: 'youtube', durationSec: 0, deps: { callVideo: v3, writeSingleBody: fakeWriter() } });
  assert.equal(r3.ok, false);
  assert.equal(r3.errorType, 'DURATION_UNKNOWN');
  assert.equal(v3.calls.length, 1, 'ถามความยาวไม่ได้ = หยุด ไม่ดูทั้งคลิปรวดเดียว');
});

test('pipeline: ไม่มี ffmpeg แต่ไฟล์แนบตรงได้ = ดูทั้งไฟล์รอบเดียวแบบลดเกรด · ช่วงที่ตอบว่าง = ดูไม่สำเร็จ', async () => {
  const video = fakeVideo();
  const r = await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 700, deps: { callVideo: video, writeSingleBody: fakeWriter(), hasFfmpeg: async () => false } });
  assert.equal(r.ok, true);
  assert.equal(video.calls.length, 1);
  assert.ok(r.insight.single.degradations.some((d) => d.type === 'no-ffmpeg-whole-pass'));

  const half = fakeVideo({ data: (opts, i) => (i === 2 ? {} : { transcript: [{ speaker: 'ผู้พูด 1', text: `เนื้อช่วง ${i} ผมจะสู้ต่อไปจนถึงที่สุด` }], keyPoints: [] }) });
  const r2 = await runClipSinglePipeline({ url: 'https://www.youtube.com/watch?v=abcdefghijk', type: 'youtube', durationSec: 1000, deps: { callVideo: half, writeSingleBody: fakeWriter() } });
  assert.equal(r2.ok, true);
  assert.equal(r2.insight.single.segments[1].ok, false);
  assert.equal(r2.insight.single.segments[1].errorType, 'WATCH_EMPTY');
  assert.ok(r2.insight.checks.some((c) => c.kind === 'segment'));
});

test('pipeline: ดูไม่สำเร็จทุกช่วง / คนเขียนล้ม / ไฟล์ใหญ่อ่านความยาวไม่ได้ = ok:false พร้อม spentTokens', async () => {
  const allFail = await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 60, deps: { callVideo: fakeVideo({ fail: () => true }), writeSingleBody: fakeWriter() } });
  assert.equal(allFail.ok, false);
  assert.equal(allFail.spentTokens, 0);

  const writerFail = await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 60,
    deps: { callVideo: fakeVideo(), writeSingleBody: async () => ({ ok: false, errorType: 'BRAIN_TIMEOUT', error: 'หมดเวลา', model: 'gemini-3.8-flash' }) } });
  assert.equal(writerFail.ok, false);
  assert.equal(writerFail.errorType, 'BRAIN_TIMEOUT');
  assert.ok(writerFail.spentTokens > 0, 'ดูคลิปไปแล้ว = จ่ายแล้ว ผู้เรียกต้องไม่ลองซ้ำอัตโนมัติ');

  const unknown = await runClipSinglePipeline({ type: 'meta', videoBuffer: buf(INLINE_CAP + 10), durationSec: 0,
    deps: { callVideo: fakeVideo(), writeSingleBody: fakeWriter(), probeBufferDurationSec: async () => 0 } });
  assert.equal(unknown.errorType, 'DURATION_UNKNOWN');

  const empty = await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 30,
    deps: { callVideo: fakeVideo({ data: () => ({ transcript: [], visuals: [], screen: [] }) }), writeSingleBody: fakeWriter() } });
  assert.equal(empty.errorType, 'EMPTY_CLIP');
});

// ── ★ รอบแก้ตามผู้ตรวจอิสระ 25 ต.ค. ──
test('writer: ช่องสมองเต็ม (BRAIN_BUSY · ยังไม่ส่งคำขอ) = รอแล้วลองใหม่ ไม่ล้มทั้งงาน', async () => {
  let calls = 0;
  const r = await writeSingleBody({ prompt: 'p', writer: { kind: 'gemini', model: 'gemini-3.8-flash', effort: 'high' }, deps: {
    sleep: async () => {},
    runBrain: async () => { calls += 1; return calls < 3 ? { ok: false, errorType: 'BRAIN_BUSY', error: 'เต็ม' } : { ok: true, json: { headline: 'ห', body: 'บ', names: [] } }; },
  } });
  assert.equal(r.ok, true);
  assert.equal(calls, 3);
  let n = 0;
  const stuck = await writeSingleBody({ prompt: 'p', writer: { kind: 'gemini', model: 'gemini-3.8-flash' }, deps: { sleep: async () => {}, runBrain: async () => { n += 1; return { ok: false, errorType: 'BRAIN_BUSY', error: 'เต็ม' }; } } });
  assert.equal(stuck.ok, false);
  assert.ok(n >= 2 && n <= 20, `ต้องมีเพดานการรอ (ลอง ${n} ครั้ง)`);
});

test('check: คำพูดยาวเกินเพดานตรวจแบบตรงตัว · คร่อมบรรทัดไม่แก้อัตโนมัติ · $ ในบทถอดไม่เพี้ยน', () => {
  const longLine = 'ก'.repeat(10) + 'คำพูดยาวมาก'.repeat(60);
  const segments = [seg({ transcript: [
    { speaker: 'ผู้พูด 1', text: longLine },
    { speaker: 'ผู้พูด 1', text: 'ผมไม่เคยคิดว่าจะได้มาถึงวันนี้เลยจริงๆ' },
    { speaker: 'ผู้พูด 2', text: 'ราคา $& 500 บาท ถูกมากจริงๆ นะครับพี่' },
  ] })];
  const body = `ข้อความ “${longLine.slice(0, 400)}X” และ “ผมไม่เคยคิดว่าจะได้มาถึงวันนี้เลยจริงๆ ราคา $& 500 บาท” และ “ราคา $& 500 บาทถูกมากจริงๆ นะครับพ”`;
  const r = checkSingleBody({ headline: 'ห', body, names: [] }, { segments });
  assert.ok(r.checks.some((c) => c.kind === 'quote' && c.text.startsWith('คำพูดยาว')), 'คำพูดยาวไม่ตรงตัว = จุดเช็ค ไม่ค้นแบบใกล้เคียง');
  assert.ok(!r.checks.some((c) => c.level === 'fixed' && c.text.includes('ผมไม่เคยคิด')), 'คร่อมสองบรรทัด/สองคน ห้ามรวมเป็นคำพูดเดียว');
  assert.ok(r.body.includes('“ราคา $& 500 บาท ถูกมากจริงๆ นะครับพี่”'), 'แทนคำพูดแล้ว $& ต้องคงเดิม');
});

test('check: คำพูดยาวบนบทถอดยาวมากต้องตรวจเสร็จเร็ว (กันเซิร์ฟเวอร์ค้าง)', () => {
  const words = ['วันนี้', 'เรา', 'มา', 'คุย', 'เรื่อง', 'ร้าน', 'กาแฟ', 'กับ', 'ชีวิต', 'ที่', 'เปลี่ยนไป', 'มาก'];
  const lines = Array.from({ length: 6000 }, (_, i) => ({ speaker: 'ผู้พูด 1', text: `${words[i % 12]}${words[(i * 7) % 12]}${words[(i * 5) % 12]} ครั้งที่ ${i}` }));
  const segments = [seg({ transcript: lines })];
  const q1 = 'เรื่องร้านกาแฟกับชีวิตที่เปลี่ยนไปมาก'.repeat(8);
  const q2 = 'คุยเรื่องร้านกาแฟ'.repeat(120);
  const t0 = Date.now();
  checkSingleBody({ headline: 'ห', body: `“${q1}” และ “${q2}”`, names: [] }, { segments });
  assert.ok(Date.now() - t0 < 5000, `ต้องเสร็จภายใน 5 วิ (ใช้ ${Date.now() - t0} ms)`);
});

test('check: ลดธงตีผิด — ชื่อที่ขึ้นต้นเหมือนคำบทบาท · ยศเต็ม · เลขภาษาพูด · คำใบ้เพศที่ไม่ใช่เพศ', () => {
  assert.deepEqual(nameTokens('คนึงนิจ'), ['คนึงนิจ']);
  assert.deepEqual(nameTokens('หญิงลี'), ['หญิงลี']);
  assert.deepEqual(nameTokens('พลตำรวจเอกสมชาย ใจดี'), ['สมชาย', 'ใจดี']);
  assert.deepEqual(nameTokens('เสียงพูดนอกกล้อง'), []);
  assert.deepEqual(nameTokens('แม่ของน้องข้าวหอม'), []);
  assert.ok(numbersIn('ขายได้พันห้า').has('1500'));
  assert.ok(numbersIn('ได้มาแสนห้า').has('150000'));
  const noGender = [seg({ transcript: [{ speaker: 'ผู้พูด 1', text: 'คะแนนรอบนี้ดีมาก บ้านอยู่ริมแม่น้ำ' }] })];
  const r = checkSingleBody({ headline: 'ห', body: 'เธอบอกว่าคะแนนดีมาก', names: [] }, { segments: noGender });
  assert.ok(r.checks.some((c) => c.kind === 'gender'), '"คะแนน" กับ "แม่น้ำ" ไม่ได้บอกเพศ');
});

test('check: คำพูดที่รวมคำของสองคนต้องขึ้นจุดเช็ค · คนเดียวพูดต่อสองบรรทัดรวมได้ · ตัดกลางคำเติมให้ครบ', () => {
  const segments = [seg({ transcript: [
    { speaker: 'ผู้พูด 1', text: 'ผมไม่เคยคิดว่าจะได้มาถึงวันนี้เลยจริงๆ' },
    { speaker: 'ผู้พูด 2', text: 'ราคานี้ถูกมากจริงๆ นะครับพี่' },
    { speaker: 'ผู้พูด 2', text: 'ใครผ่านมาแวะได้เลย' },
  ] })];
  const r = checkSingleBody({ headline: 'ห', names: [], body: '“ผมไม่เคยคิดว่าจะได้มาถึงวันนี้เลยจริงๆ ราคานี้ถูกมาก” และ “ราคานี้ถูกมากจริงๆ นะครับพี่ ใครผ่านมาแวะได้เลย” และ “ราคานี้ถูกมากจริงๆ นะครับพ”' }, { segments });
  assert.ok(r.checks.some((c) => c.kind === 'quote' && c.text.includes('มากกว่าหนึ่งคน')), 'รวมคำผู้พูด 1 กับ 2 ต้องติดธง');
  assert.ok(!r.checks.some((c) => c.text.includes('ใครผ่านมาแวะได้เลย') && c.level === 'check'), 'คนเดียวพูดต่อสองบรรทัด = ผ่าน');
  assert.ok(r.body.endsWith('และ “ราคานี้ถูกมากจริงๆ นะครับพี่”'), 'ตัดกลางคำ (ขาด ี่) ต้องเติมให้ครบตามบทถอด');
});

// ── ★ รอบแก้ตามผู้ตรวจอิสระรอบ 2 ──
test('check (รอบ 2): คำพูดคร่อมบรรทัดบนบทถอด 2 ชม. (บรรทัดยาว ~110 ตัว × 2,400) ต้องตรวจเสร็จใน 3 วิ', () => {
  const vocab = ['ร้านกาแฟ', 'ชีวิต', 'ครอบครัว', 'ทำงาน', 'ลูกค้า', 'เงินเดือน', 'ความฝัน', 'ต่างจังหวัด', 'รถไฟ', 'ตลาดนัด', 'ขนมปัง', 'สวนผัก'];
  const lines = Array.from({ length: 2400 }, (_, i) => ({
    speaker: 'ผู้พูด 1',
    text: Array.from({ length: 12 }, (_, k) => vocab[(i * 7 + k * 5) % 12]).join(' ') + ` ครั้งที่ ${i}`,
  }));
  const segments = [seg({ transcript: lines })];
  const quotes = [100, 500, 900, 1300, 1700, 2000, 2200, 2390].map((i) => {
    const tail = lines[i].text.slice(-30);
    const head = lines[i + 1].text.slice(0, 30);
    return `“${tail} ${head.slice(0, 10)}x${head.slice(11)}”`;
  });
  const t0 = Date.now();
  checkSingleBody({ headline: 'ห', body: quotes.join(' และ '), names: [] }, { segments });
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, `ต้องเสร็จภายใน 3 วิ (ใช้ ${ms} ms)`);
});

test('check (รอบ 2): ขึ้นบรรทัดใหม่ในข้อความ ป้ายผู้พูดไม่เลื่อน · "ผู้พูด 1" คนละช่วง = คนละคน · ไม่มีป้าย = ไม่ทราบตัว', () => {
  const embedded = [seg({ transcript: [
    { speaker: 'พิธีกร', text: 'แล้วตอนนี้\nอยู่ที่ไหนครับ' },
    { speaker: 'ป้าแดง', text: 'อยู่ศาลาวัดกับหลานสองคน' },
  ] })];
  const r1 = checkSingleBody({ headline: 'ห', names: [], body: 'ป้าแดงบอกว่า “อยู่ที่ไหนครับ อยู่ศาลาวัดกับหลานสองคน”' }, { segments: embedded });
  assert.ok(r1.checks.some((c) => c.text.includes('มากกว่าหนึ่งคน')), 'รวมคำพิธีกรกับป้าแดงต้องติดธง แม้ข้อความมีขึ้นบรรทัดใหม่ซ่อน');
  assert.ok(!r1.checks.some((c) => c.level === 'fixed'), 'ห้ามรับรองว่าตรงคลิป');
  assert.equal(normalizeWatch({ transcript: [{ speaker: 'ก', text: 'บรรทัดหนึ่ง\n  บรรทัดสอง' }] }).transcript[0].text, 'บรรทัดหนึ่ง บรรทัดสอง');

  const crossSeg = [
    seg({ no: 1, startSec: 0, endSec: 360, transcript: [{ speaker: 'ผู้พูด 1', text: 'ผมเปิดร้านมาตั้งแต่ปีที่แล้วครับ' }] }),
    seg({ no: 2, startSec: 360, endSec: 720, transcript: [{ speaker: 'ผู้พูด 1', text: 'ดิฉันเป็นลูกค้าประจำค่ะ' }] }),
  ];
  const r2 = checkSingleBody({ headline: 'ห', names: [], body: '“ผมเปิดร้านมาตั้งแต่ปีที่แล้วครับ ดิฉันเป็นลูกค้าประจำค่ะ”' }, { segments: crossSeg });
  assert.ok(r2.checks.some((c) => c.text.includes('มากกว่าหนึ่งคน')), '"ผู้พูด 1" คนละช่วงต้องนับเป็นคนละคน');

  const unknown = [seg({ transcript: [{ speaker: '', text: 'ไม่รู้ว่าใครพูดประโยคนี้' }, { speaker: 'สมชาย', text: 'ผมเป็นคนพูดประโยคนี้' }] })];
  const r3 = checkSingleBody({ headline: 'ห', names: [], body: '“ไม่รู้ว่าใครพูดประโยคนี้ ผมเป็นคนพูดประโยคนี้”' }, { segments: unknown });
  assert.ok(r3.checks.some((c) => c.text.includes('มากกว่าหนึ่งคน')), 'บรรทัดไม่มีป้ายต่อกับบรรทัดมีป้าย = ติดธง');
});

test('pipeline (รอบ 2): คำถามความยาว YouTube ให้เพดานคำตอบพอ · อ่าน "h:mm:ss" ได้ · ค่าเพี้ยนเกิน 6 ชม. ไม่เชื่อ', async () => {
  const v = fakeVideo({ data: (opts, i) => (i === 1 ? { durationSec: '0:15:00' } : { transcript: [{ speaker: 'ผู้พูด 1', text: `ช่วง ${i} สวัสดีครับ วันนี้มาเล่าเรื่องร้านกาแฟ` }], keyPoints: [] }) });
  const r = await runClipSinglePipeline({ url: 'https://www.youtube.com/watch?v=abcdefghijk', type: 'youtube', durationSec: 0, deps: { callVideo: v, writeSingleBody: fakeWriter() } });
  assert.ok(v.calls[0].maxTokens >= 2000, 'รุ่นที่คิดก่อนตอบต้องมีเพดานพอ');
  assert.equal(r.ok, true);
  assert.equal(r.insight.clipDurationSec, 900);
  const crazy = fakeVideo({ data: (opts, i) => (i === 1 ? { durationSec: 99999 } : {}) });
  const r2 = await runClipSinglePipeline({ url: 'https://www.youtube.com/watch?v=abcdefghijk', type: 'youtube', durationSec: 0, deps: { callVideo: crazy, writeSingleBody: fakeWriter() } });
  assert.equal(r2.errorType, 'DURATION_UNKNOWN');
  assert.equal(crazy.calls.length, 1);
});

// ★ 26 ต.ค. 69 (เฟส 3) — ธงตีผิดที่เจอจริงตอนเทียบคนเขียน 10 คลิป (เฟส 2): ทุกกรณีมาจากเนื้อจริงของคลิปเหล่านั้น
test('check (เฟส 3): เวลาแบบพูด "สามทุ่ม" = 21.00 · โควิด-19 ไม่ใช่ตัวเลข · ช่วงโฆษณา/ปิดรายการไม่เรียกร้องความครบ · "บิดา" ไม่ใช่ชื่อ', () => {
  assert.deepEqual(clockHours('รอตั้งสามทุ่ม'), [21]);
  assert.deepEqual(clockHours('3 ทุ่มครึ่ง'), [21, 21.3]);
  assert.deepEqual(clockHours('บ่ายโมง'), [13]);
  assert.deepEqual(clockHours('ตีสาม'), [3]);
  assert.ok(clockHours('สี่โมงเย็น').includes(16));
  assert.deepEqual(clockHours('เที่ยงคืน'), [0, 24], 'เที่ยงคืนต้องไม่ถูกนับเป็นเที่ยงวันด้วย');
  assert.deepEqual(clockHours('เที่ยง'), [12]);
  assert.deepEqual(clockHours('สิบเอ็ดทุ่ม'), [], 'ทุ่มมีแค่ 1–6');

  const segs = [seg({
    endSec: 600,
    transcript: [{ t: '1:31', speaker: 'จ๊ะจ๋า', text: 'กว่าจ๋าจะได้คุยเรื่องธุระกับพี่จิ๊บอ่ะ โห รอตั้งสามทุ่ม' }],
    keyPoints: [
      'เบลล่าเล่าว่าอเล็กซ์เป็นคนแนะนำให้ลองดื่มแบรนด์ซุปไก่สกัดสูตรปรับปรุงใหม่',
      'ชมพู่ อารยา และผู้ดำเนินรายการกล่าวขอบคุณสถานที่และปิดรายการ',
      'จ๊ะจ๋าต้องรอคุยกับพี่จิ๊บจนดึกทุกวัน',
    ],
  })];
  const draft = {
    headline: 'จ๊ะจ๋ารอคุยกับพี่จิ๊บจนดึก',
    body: 'จ๊ะจ๋าต้องรอคุยกับพี่จิ๊บจนดึกถึงเวลาประมาณ 21.00 น. ทุกวัน เริ่มทำคลิปช่วงโควิด-19 และ COVID 19',
    names: ['จ๊ะจ๋า', 'บิดา'],
  };
  const r = checkSingleBody(draft, { segments: segs });
  // ปิดรายการ = ข้าม · ช่วงเชียร์สินค้า = ยังขึ้นธง แต่ต่อป้าย "อาจเป็นช่วงโปรโมต" (ผู้ตรวจรอบ 3: ไม่ซ่อน ให้คนตัดสิน)
  const left = r.checks.filter((c) => c.level === 'check');
  assert.equal(left.length, 1, JSON.stringify(r.checks));
  assert.equal(left[0].kind, 'coverage');
  assert.match(left[0].text, /ซุปไก่สกัด.*\(อาจเป็นช่วงโปรโมต — ถ้าใช่ ไม่ต้องเขียนถึง\)$/);
  assert.equal(r.stats.keyPointsSkipped, 1);
  assert.equal(r.stats.numbers, 1, 'นับแค่ 21.00 — เลขในชื่อโรคไม่ใช่ข้อเท็จจริงเชิงตัวเลข');

  // ด่านยังกัดของผิดจริง: เวลาที่คลิปไม่ได้พูด · ประเด็นจริงที่ตกหล่น · ชื่อที่ไม่มีหลักฐาน
  const bad = checkSingleBody({ headline: 'x', body: 'นัดกันเวลา 22.00 น. ทุกวัน', names: ['สมศรี'] }, { segments: segs });
  const kinds = bad.checks.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ['coverage', 'coverage', 'name', 'number']);
});

// 🔴 ผู้ตรวจอิสระ 26 ต.ค. (FAIL รอบ 1): กฎลดธงต้องไม่ทำให้ของผิดจริงหลุด — ทุกประโยคข้างล่าง ตัวตรวจก่อนเฟส 3 ขึ้นธง ต้องยังขึ้นธง
test('check (เฟส 3 · ทิศกลับ): เวลาแบบพูดใช้ได้เฉพาะตัวเลขที่เขียนแบบเวลา · โควิดข้ามเฉพาะ 19 · โฆษณาคำเดี่ยวไม่ข้าม', () => {
  const flagged = (spoken, written, keyPoints = []) => checkSingleBody(
    { headline: 'ข่าว', body: written, names: [] },
    { segments: [seg({ endSec: 300, transcript: [{ t: '0:01', speaker: 'ผู้พูด 1', text: spoken }], keyPoints })] },
  ).checks.filter((c) => c.level === 'check').map((c) => c.kind);
  // เวลาแบบพูดเป็นหลักฐานให้ "ตัวเลขทั่วไป" ไม่ได้
  assert.deepEqual(flagged('เกิดเหตุตอนบ่ายสองโมง', 'เสียหาย 14 ล้านบาท'), ['number']);
  assert.deepEqual(flagged('ห้าโมงเย็นก็กลับบ้าน', 'บาดเจ็บ 17 ราย'), ['number']);
  assert.deepEqual(flagged('ขอความเที่ยงธรรมให้ลูกด้วย', 'มีลูก 12 คน'), ['number']);
  assert.deepEqual(flagged('ขอความเที่ยงธรรมให้ลูกด้วย', 'นัดกันเวลา 12.00 น.'), ['number'], '"เที่ยงธรรม" ไม่ใช่เที่ยงวัน');
  assert.deepEqual(flagged('ทั้งสองทุ่มเทให้กันมาก', 'นัดกันเวลา 20.00 น.'), ['number'], '"ทุ่มเท" ไม่ใช่สองทุ่ม');
  // แต่ตัวเลขที่เขียนแบบเวลาใช้คำบอกเวลาเป็นหลักฐานได้ทุกรูป
  assert.deepEqual(flagged('เกิดเหตุตอนบ่ายสองโมง', 'เกิดเหตุเวลา 14.00 น.'), []);
  assert.deepEqual(flagged('รอตั้งสามทุ่ม', 'รอถึงเวลาประมาณ 21:00 น.'), [], 'รูป 21:00 (ไม่นับ 00 เป็นตัวเลขแยก)');
  assert.deepEqual(flagged('สามทุ่มครึ่งค่อยได้คุย', 'คุยกันเวลา 21:30'), []);
  assert.deepEqual(flagged('เริ่มงานเที่ยง', 'เริ่มงาน 12 นาฬิกา'), []);
  // โควิด: ข้ามเฉพาะชื่อโรค 19
  assert.deepEqual(flagged('ช่วงนั้นมีคนป่วยเยอะ', 'ผู้ป่วยโควิด 350 ราย'), ['number']);
  assert.deepEqual(flagged('เคยป่วยหนักมาก', 'ติดโควิด 3 ครั้ง'), ['number']);
  // ประเด็นข่าวจริงที่มีคำว่าโฆษณา/แบรนด์/ส่วนลด ต้องยังถูกตรวจความครบ
  for (const p of ['เจ้าของร้านโฆษณาเกินจริงว่าครีมรักษามะเร็งได้จนถูกจับกุม', 'แบรนด์ดังยื่นฟ้องร้านค้าละเมิดลิขสิทธิ์', 'พนักงานโกงส่วนลดผู้สูงอายุ']) {
    assert.equal(isPromoPoint(p), false, p);
    assert.deepEqual(flagged('เรื่องอื่นล้วน', 'เนื้อข่าวเรื่องอื่น', [p]), ['coverage'], p);
  }
  // ผู้ตรวจอิสระรอบ 2: เวลา HH:MM ตรวจเป็นค่าเดียว (ห้ามชั่วโมงเดี่ยวช่วยผ่าน) · คู่ที่ไม่ใช่เวลาตรวจทีละเลข
  assert.deepEqual(flagged('รอตั้งสามทุ่ม', 'เกิดเหตุเวลา 21:45 น.'), ['number']);
  assert.deepEqual(flagged('เกิดเหตุตอนบ่ายสองโมง', 'นัดกันเวลา 14:50 น.'), ['number']);
  assert.deepEqual(flagged('แข่งกันสนุกมาก', 'ทีมชนะไป 3:15'), ['number'], 'คู่ที่มีโคลอนต้องตรวจ ไม่ข้ามเลขหลัง');
  assert.deepEqual(flagged('ใช้แผนที่เก่า', 'มาตราส่วน 2:250'), ['number', 'number'], 'นาที 3 หลักไม่ใช่เวลา ตรวจทั้งสองเลข');
  assert.deepEqual(flagged('ทั้งสองทุ่มสุดตัว', 'ซ้อมจนถึง 20.00 น.'), ['number']);
  assert.deepEqual(flagged('บนจอขึ้นว่า 21:45', 'เกิดเหตุเวลา 21:45 น.'), [], 'เวลาที่คลิปเขียนไว้ตรงตัวต้องผ่าน');
  // ข่าวผลิตภัณฑ์อันตราย/ของปลอม/เด็กหาย ต้องไม่ถูกตีเป็นช่วงโปรโมต
  for (const p of ['หญิงสาววัย 20 ลองกินผลิตภัณฑ์ลดน้ำหนักจากออนไลน์จนหัวใจวายเสียชีวิต', 'แพทย์แนะนำให้หยุดใช้ผลิตภัณฑ์ครีมเถื่อนทันทีเพราะมีสารปรอท',
    'แม่ค้าแนะนำให้ลูกค้าซื้อสินค้าแบรนด์เนมปลอมในราคาเต็ม', 'อย. พบสินค้าสูตรใหม่ผสมสารสเตียรอยด์เกินมาตรฐานสั่งเก็บทั้งหมด',
    'ครอบครัวฝากติดตามหาเด็กหญิงวัย 7 ขวบที่หายตัวไปจากหน้าบ้าน',
    'นายกฯ แนะนำให้ประชาชนใช้สินค้าไทยช่วยชาติ', 'ญาติฝากติดตามความคืบหน้าคดีของลูกชาย']) {
    assert.equal(isPromoPoint(p), false, p);
    assert.deepEqual(flagged('เรื่องอื่นล้วน', 'เนื้อข่าวเรื่องอื่น', [p]), ['coverage'], p);
  }
  // ผู้ตรวจรอบ 3: ข่าวสินค้า/รีวิว/ดราม่าพรีเซนเตอร์ที่ไม่มีคำข่าวร้าย — ห้ามข้าม (ยังขึ้นธงความครบ)
  for (const p of ['นักเรียนคิดค้นผลิตภัณฑ์สูตรใหม่จากเปลือกทุเรียนจนคว้ารางวัลระดับโลก', 'ยูทูบเบอร์ลองกินขนมแบรนด์ใหม่จากญี่ปุ่นแล้วให้คะแนนแค่ 2 เต็ม 10',
    'ป้าวัย 70 คิดผลิตภัณฑ์สมุนไพรสูตรใหม่ขายออนไลน์จนมีรายได้เดือนละแสน', 'นักร้องดังตอบดราม่าถูกจ้างเป็นพรีเซนเตอร์ให้แบรนด์คู่แข่งของค่ายเดิม',
    'บริษัทให้ลูกค้าลองใช้สินค้าฟรีก่อนส่งบิลเรียกเก็บเงินย้อนหลังหลายหมื่นบาท']) {
    assert.equal(isPromoPoint(p), false, p);
    assert.deepEqual(flagged('เรื่องอื่นล้วน', 'เนื้อข่าวเรื่องอื่น', [p]), ['coverage'], p);
  }
  // ช่วงปิดรายการ = ข้ามได้ · ช่วงเชียร์สินค้า (เคสเบลล่าเฟส 2 + โปรโมตอาหารเสริมที่มี "สารสกัด"/"หายเหนื่อย") = ไม่ข้าม แต่ติดป้าย
  assert.equal(isPromoPoint('ชมพู่ อารยา และผู้ดำเนินรายการกล่าวขอบคุณสถานที่และปิดรายการ PASSCODE ประจำอีพีนี้'), true);
  for (const p of ['เบลล่าเล่าว่าอเล็กซ์ เรนเดลล์ เป็นคนแนะนำให้ลองดื่มแบรนด์ซุปไก่สกัดสูตรปรับปรุงใหม่เพื่อแก้อาการเหนื่อยล้า',
    'เบลล่าเผยความรู้สึกตอนได้รับการติดต่อให้เป็นพรีเซนเตอร์แบรนด์ซุปไก่สกัดสูตรใหม่',
    'พิธีกรแนะนำให้ลองดื่มผลิตภัณฑ์สารสกัดจากโสมของสปอนเซอร์', 'ดาราเล่าว่าลองดื่มแบรนด์นี้แล้วหายเหนื่อยทันที']) {
    assert.equal(isPromoPoint(p), false, p);
    assert.equal(maybePromoPoint(p), true, p);
    const c = checkSingleBody({ headline: 'x', body: 'เนื้อเรื่องอื่น', names: [] }, { segments: [seg({ keyPoints: [p] })] }).checks;
    assert.match(c[0].text, /\(อาจเป็นช่วงโปรโมต/, p);
  }
  // วลีปิดรายการที่มากับข่าวร้าย ห้ามข้าม
  assert.equal(isPromoPoint('ผู้ชมร้องเรียนช่วงโฆษณาขายยาปลอมในรายการ'), false);
  // ผู้ตรวจรอบ 4: คำปิดรายการแบบคำเดี่ยวห้ามกลืนข่าวจริง — ต้องเป็นประโยคชวน หรือ เข้า/พักช่วงโฆษณา
  for (const p of ['ช่องของยายวัย 80 มีผู้กดซับทะลุหนึ่งล้านคนภายในสามเดือน', 'คลิปของเด็กหญิงมีคนกดไลก์ทะลุ 2 ล้านครั้งภายในคืนเดียว',
    'พิธีกรหลุดพูดคำหยาบช่วงโฆษณาโดยไม่รู้ว่าไมค์ยังเปิดอยู่จนเป็นดราม่า', 'ตำรวจไซเบอร์กดติดตามบัญชีมิจฉาชีพจนสาวถึงตัวการใหญ่',
    'ชาวบ้านช่วยกันติดตามหาเด็กชายที่เดินออกจากบ้านตั้งแต่เมื่อวาน', 'ฝากกดติดตามช่องไว้รู้ทันมิจฉาชีพ',
    'คนทั้งประเทศพูดถึงช่วงโฆษณาฟุตบอลที่ถ่ายทำในหมู่บ้านเล็กๆ ทางภาคเหนือ',
    // ผู้ตรวจรอบ 5: ซับ = ซึมซับ · ขอให้ติดตามสถานการณ์ · ชวนติดตาม = สำนวนน่าติดตาม
    'ชาวบ้านช่วยกันซับน้ำมันที่รั่วไหลลงทะเลด้วยผ้าและฟางนานหลายชั่วโมง', 'ผู้ว่าราชการจังหวัดขอให้ทุกคนติดตามสถานการณ์น้ำอย่างใกล้ชิดเพราะระดับน้ำยังสูงขึ้น',
    'ปริศนาเงินสดสองล้านบาทที่หายไปจากตู้เซฟในบ้านยังชวนติดตาม', 'เรื่องราวความรักต่างวัยของคู่รักชวนติดตามว่าจะได้แต่งงานกันหรือไม่',
    // ผู้ตรวจรอบ 6: ช่องทาง ≠ ช่อง · รายการชื่อ ≠ รายการทีวี
    'กระทรวงการคลังขอให้ติดตามช่องทางลงทะเบียนรับเงินเยียวยารอบใหม่ผ่านแอปเป๋าตัง', 'ผู้ใหญ่บ้านฝากติดตามช่องทางรับบริจาคสำหรับผู้ประสบภัยน้ำท่วม',
    'ขอให้ทุกคนติดตามรายการชื่อผู้มีสิทธิ์รับเงินที่จะประกาศพรุ่งนี้']) {
    assert.equal(isPromoPoint(p), false, p);
    assert.deepEqual(flagged('เรื่องอื่นล้วน', 'เนื้อข่าวเรื่องอื่น', [p]), ['coverage'], p);
  }
  for (const p of ['ทั้งคู่ฝากกดไลก์กดแชร์และกดติดตามช่องก่อนจบคลิป', 'อย่าลืมกดซับเพื่อไม่พลาดตอนต่อไป', 'พิธีกรขอพักช่วงโฆษณาก่อนกลับมาคุยต่อ',
    'ยูทูบเบอร์ฝากทุกคนกดซับช่องและกดกระดิ่งแจ้งเตือน', 'พิธีกรชวนผู้ชมติดตามรายการตอนหน้า',
    'พิธีกรขอให้ผู้ชมกดกระดิ่งแจ้งเตือนเพื่อไม่พลาดตอนต่อไป', 'ฝากติดตามช่องของเราด้วยนะ']) assert.equal(isPromoPoint(p), true, p);
  // ป้ายโปรโมตต้องไม่ไปติดข่าวทั่วไป/ข่าวร้าย
  for (const p of ['นายกฯ แนะนำให้ประชาชนใช้สินค้าไทยช่วยชาติ', 'หญิงสาววัย 20 ลองกินผลิตภัณฑ์ลดน้ำหนักจากออนไลน์จนหัวใจวายเสียชีวิต']) assert.equal(maybePromoPoint(p), false, p);
});
