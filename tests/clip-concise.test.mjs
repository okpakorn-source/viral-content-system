/**
 * ★ 28 ต.ค. 69 — ร้อยแก้วกระชับ (เจ้าของสั่งขึ้นระบบหลังห้องทดลองเนื้อดิบ 5 แนวทาง × 3 คลิป)
 *   คลิป ≤8 นาที: Gemini 3.8 คิดสูง ดูวิดีโอแล้วเขียนรอบเดียว · คลิปยาว: บทถอดทุกช่วง → เขียนร้อยแก้วกระชับ
 *   ตัวตรวจข้ามด่านที่ต้องเทียบบทถอดเมื่อไม่มีบทถอด · CLIP_RAW_STYLE=full = ทางเดิม 25 ต.ค.
 *   ไม่ยิง AI จริง (ตัวแทนทั้งหมด)
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { runClipSinglePipeline, resolveRawStyle, INLINE_CAP, DEFAULT_CONCISE_MODEL } from '../src/lib/services/clipSingle/pipeline.js';
import { checkSingleBody } from '../src/lib/services/clipSingle/check.js';
import {
  buildConcisePassPrompt, buildConciseWriterPrompt, CONCISE_WRITER_SYSTEM, CONCISE_REV, SINGLE_REV,
} from '../src/lib/services/clipSingle/prompts.js';
import { callClipGeminiVideo } from '../src/lib/services/clipBrain/clipGeminiVideo.js';
import { writeSingleBody } from '../src/lib/services/clipSingle/writer.js';
import { SINGLE_WRITER_SYSTEM } from '../src/lib/services/clipSingle/prompts.js';
import { cardView, CHECK_KIND_LABEL } from '../src/app/clip-transcript/ui/statusMeta.js';
import { createHash } from 'node:crypto';

delete process.env.CLIP_RAW_STYLE;
delete process.env.CLIP_CONCISE_MODEL;
delete process.env.CLIP_CONCISE_EFFORT;

const buf = (n) => Buffer.alloc(n, 1);
const WATCH_DATA = { transcript: [{ t: '0:30', speaker: 'ลุงสมชาย', text: 'ผมขายก๋วยเตี๋ยวมาสามสิบปีแล้วครับ' }], keyPoints: ['ลุงขายก๋วยเตี๋ยว 30 ปี'] };
const DRAFT = { headline: 'ลุงสมชายขายก๋วยเตี๋ยว 30 ปี', body: 'ลุงสมชายขายก๋วยเตี๋ยวริมทางมา 30 ปี\n\nลุงบอกว่า "ผมขายก๋วยเตี๋ยวมาสามสิบปีแล้วครับ"' };

/** ตัวแทน Gemini ดูวิดีโอ — ตอบตามชนิดคำสั่ง (เขียนรอบเดียว / ถอดบท) */
function fakeVideo({ data, fail } = {}) {
  const calls = [];
  const fn = async (opts) => {
    calls.push(opts);
    if (fail?.(opts, calls.length)) return { ok: false, errorType: 'BUSY', error: 'แน่น', receipt: { elapsedMs: 5 } };
    await opts.onUsage?.({ inputTokens: 1000, outputTokens: 300, totalTokens: 1300 });
    const isPass = /คุณคือคนที่เพิ่งนั่งดูคลิปนี้จบ/.test(opts.prompt);
    return { ok: true, receipt: { elapsedMs: 10, model: opts.model }, data: data?.(opts, calls.length) ?? (isPass ? DRAFT : WATCH_DATA) };
  };
  fn.calls = calls;
  return fn;
}
function fakeWriter(draft = { ...DRAFT, names: ['ลุงสมชาย'] }) {
  const fn = async (o) => { fn.calls.push(o); return { ok: true, draft, model: 'gemini-3.8-flash', kind: 'gemini', elapsedMs: 3, tokensUsed: 500 }; };
  fn.calls = [];
  return fn;
}

test('สวิตช์: ค่าเริ่มต้น = ร้อยแก้วกระชับ · full = ทางเดิม · ค่าแปลก = กระชับ', () => {
  assert.equal(resolveRawStyle(), 'concise');
  assert.equal(resolveRawStyle('full'), 'full');
  assert.equal(resolveRawStyle('FULL'), 'full');
  assert.equal(resolveRawStyle('อะไรก็ได้'), 'concise');
  process.env.CLIP_RAW_STYLE = 'full';
  try { assert.equal(resolveRawStyle(), 'full'); } finally { delete process.env.CLIP_RAW_STYLE; }
});

test('คำสั่ง: ดูรอบเดียวมีกฎห้องทดลองครบ · ขอความยาวเฉพาะตอนไม่รู้ · คลิปยาวเลิกเพดาน 2–6 ย่อหน้าและขอรายชื่อ', () => {
  const p = buildConcisePassPrompt({ platform: 'tiktok', durationSec: 95, caption: 'ลุงสมชาย #ก๋วยเตี๋ยว' });
  for (const rule of ['ทุกประโยคต้องมีข้อเท็จจริง', 'ไม่ใช้คำเชื่อมแบบเอกสาร', 'ใช้ชื่อคนเป็นประธาน', 'ห้ามเดาเพศ', 'ไม่เอ่ยชื่อรายการ', 'ร้อยแก้ว 2–6 ย่อหน้าสั้น', 'ขึ้นต้นด้วยตัวข่าว', 'ลุงสมชาย #ก๋วยเตี๋ยว', '1:35']) {
    assert.ok(p.includes(rule), `คำสั่งดูรอบเดียวต้องมี: ${rule}`);
  }
  assert.ok(!p.includes('durationSec'));
  assert.ok(buildConcisePassPrompt({ wantDuration: true }).includes('"durationSec"'));
  assert.ok(p.includes('ขึ้นบรรทัดใหม่ด้วย \\n'), 'ตัวอย่าง JSON ต้องบอก \\n เป็นตัวอักษร (ไม่ใช่ขึ้นบรรทัดจริง) ตรงกับห้องทดลอง');

  const w = buildConciseWriterPrompt({ platform: 'meta', durationSec: 1500, transcriptBlock: '[ช่วงที่ 1 · 0:00–5:00]\nลุง: สวัสดี' });
  assert.ok(w.includes('[ช่วงที่ 1 · 0:00–5:00]') && w.includes('เขียนจากบทถอดด้านล่างเท่านั้น') && w.includes('ห้ามตัดเรื่องที่มีน้ำหนักทิ้ง'));
  assert.ok(!w.includes('2–6 ย่อหน้า'), 'คลิปยาวห้ามจำกัด 2–6 ย่อหน้า (จุดอ่อนตกรายละเอียดที่ห้องทดลองพบ)');
  assert.ok(w.includes('"names"'));
  assert.ok(/JSON/.test(CONCISE_WRITER_SYSTEM));
});

test('คลิปสั้น (ไฟล์): ดูแล้วเขียนรอบเดียว ไม่เรียกคนเขียน · Gemini 3.8 คิดสูง · ไม่มีบทถอด · ติดจุดเช็คคำพูด', async () => {
  const video = fakeVideo();
  const writer = fakeWriter();
  const r = await runClipSinglePipeline({ url: 'https://vt.tiktok.com/x/', type: 'tiktok', videoBuffer: buf(50_000), durationSec: 95, caption: 'ลุงสมชาย', deps: { callVideo: video, writeSingleBody: writer } });
  assert.equal(r.ok, true);
  assert.equal(video.calls.length, 1);
  assert.equal(writer.calls.length, 0, 'ทางดูรอบเดียวห้ามเรียกคนเขียนแยก');
  const c = video.calls[0];
  assert.ok(c.videoBuffer && !c.youtubeUrl && c.videoRange === null);
  assert.equal(c.model, DEFAULT_CONCISE_MODEL);
  assert.equal(c.thinkingLevel, 'high');
  assert.equal(c.temperature, 0.3);
  assert.equal(c.maxTokens, 24000);
  assert.ok(c.prompt.includes('ร้อยแก้ว 2–6 ย่อหน้าสั้น') && c.prompt.includes('ลุงสมชาย'));
  assert.equal(r.insight.engine, 'clip-single');
  assert.equal(r.insight.body, DRAFT.body);
  assert.equal(r.insight.rawData, DRAFT.body);
  assert.equal(r.insight.headline, DRAFT.headline);
  assert.equal(r.insight.promptRev, CONCISE_REV);
  assert.equal(r.insight.single.style, 'concise');
  assert.equal(r.insight.single.writer.kind, 'gemini-video');
  assert.equal(r.insight.single.transcriptChars, 0);
  assert.equal(r.transcriptText, '');
  assert.equal(r.insight.clipDurationSec, 95);
  assert.equal(r.spentTokens, 1300);
  assert.deepEqual(r.insight.checks.map((x) => x.kind), ['unverified'], 'ยังไม่ได้เทียบบทถอด = บอกพนักงานหนึ่งจุด ไม่ติดธงผิดรายข้อ');
  assert.ok(r.insight.checks[0].text.includes('คำพูด') && r.insight.checks[0].text.includes('1 จุด'));
  assert.ok(r.insight.single.steps.some((s) => s.name === 'ดูคลิปแล้วเขียนรอบเดียว'));
});

test('คลิปสั้น (YouTube): ใช้ลิงก์ทั้งคลิป ไม่มีกรอบเวลา · env เปลี่ยนรุ่น/ระดับคิดได้', async () => {
  process.env.CLIP_CONCISE_MODEL = 'gemini-3.9-flash';
  process.env.CLIP_CONCISE_EFFORT = 'medium';
  try {
    const video = fakeVideo();
    const r = await runClipSinglePipeline({ url: 'https://www.youtube.com/watch?v=abcdefghijk', type: 'youtube', durationSec: 300, deps: { callVideo: video, writeSingleBody: fakeWriter() } });
    assert.equal(r.ok, true);
    assert.equal(video.calls.length, 1);
    assert.equal(video.calls[0].youtubeUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
    assert.equal(video.calls[0].videoRange, null);
    assert.equal(video.calls[0].model, 'gemini-3.9-flash');
    assert.equal(video.calls[0].thinkingLevel, 'medium');
    assert.equal(r.insight.single.watchModel, 'gemini-3.9-flash');
  } finally { delete process.env.CLIP_CONCISE_MODEL; delete process.env.CLIP_CONCISE_EFFORT; }
});

test('คลิปสั้นแต่ไฟล์ใหญ่เกินแนบตรง: ย่อไฟล์เป็นช่วงเดียวแล้วดูรอบเดียว', async () => {
  const video = fakeVideo();
  let cutPlan;
  const cut = async (b, plan) => { cutPlan = plan; return { ok: true, segments: plan.map((s) => ({ ...s, buffer: buf(40_000) })) }; };
  const r = await runClipSinglePipeline({ type: 'meta', videoBuffer: buf(INLINE_CAP + 1), durationSec: 400, deps: { callVideo: video, writeSingleBody: fakeWriter(), cutSegments: cut, hasFfmpeg: async () => true } });
  assert.equal(r.ok, true);
  assert.deepEqual(cutPlan, [{ no: 1, startSec: 0, endSec: 400 }]);
  assert.equal(video.calls.length, 1);
  assert.equal(video.calls[0].videoBuffer.length, 40_000, 'ต้องส่งไฟล์ที่ย่อแล้ว');
  assert.equal(video.calls[0].thinkingLevel, 'high');
});

test('ไม่รู้ความยาว (ไฟล์เล็ก): ขอความยาวในคำตอบเดียวกัน · ค่าเพี้ยนไม่เชื่อ', async () => {
  const video = fakeVideo({ data: () => ({ ...DRAFT, durationSec: '1:15' }) });
  const r = await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 0, deps: { callVideo: video, writeSingleBody: fakeWriter(), probeBufferDurationSec: async () => 0 } });
  assert.equal(r.ok, true);
  assert.ok(video.calls[0].prompt.includes('"durationSec"'));
  assert.equal(r.insight.clipDurationSec, 75);
  assert.equal(r.insight.single.segments[0].endSec, 75);

  const weird = fakeVideo({ data: () => ({ ...DRAFT, durationSec: 999999 }) });
  const r2 = await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 0, deps: { callVideo: weird, writeSingleBody: fakeWriter(), probeBufferDurationSec: async () => 0 } });
  assert.equal(r2.ok, true);
  assert.equal(r2.insight.clipDurationSec, 0);
});

test('คลิปยาว: ถอดบททุกช่วงตามเดิม → คนเขียนร้อยแก้วกระชับจากบทถอด · ตัวตรวจเทียบบทถอดครบ', async () => {
  const video = fakeVideo();
  const writer = fakeWriter({ headline: 'ลุงสมชาย 30 ปี', body: 'ลุงสมชายบอกว่า "ผมขายก๋วยเตี๋ยวมาสามสิบปีแล้วคับ"', names: ['ลุงสมชาย'] });
  const cut = async (b, plan) => ({ ok: true, segments: plan.map((s) => ({ ...s, buffer: buf(20_000) })) });
  const r = await runClipSinglePipeline({ type: 'meta', videoBuffer: buf(30_000), durationSec: 1500, deps: { callVideo: video, writeSingleBody: writer, cutSegments: cut, hasFfmpeg: async () => true } });
  assert.equal(r.ok, true);
  assert.equal(video.calls.length, 5);
  assert.ok(video.calls.every((c) => /งานนี้คือ "ถอด"/.test(c.prompt) && !c.thinkingLevel), 'คลิปยาวยังถอดบทด้วยคำสั่งเดิม');
  assert.equal(writer.calls.length, 1);
  assert.ok(writer.calls[0].prompt.includes('เขียนจากบทถอดด้านล่างเท่านั้น') && writer.calls[0].prompt.includes('ผมขายก๋วยเตี๋ยวมาสามสิบปีแล้วครับ'));
  assert.equal(writer.calls[0].systemPrompt, CONCISE_WRITER_SYSTEM);
  assert.ok(r.insight.checks.some((c) => c.level === 'fixed' && c.kind === 'quote'), 'คลิปยาวยังแก้คำพูดให้ตรงบทถอดได้');
  assert.ok(r.insight.body.includes('แล้วครับ'));
  assert.equal(r.insight.promptRev, CONCISE_REV);
  assert.ok(r.transcriptText.includes('ผมขายก๋วยเตี๋ยว'));
});

test('ไม่มี ffmpeg + คลิปเกิน 8 นาทีแต่ไฟล์แนบตรงได้: ไปทางบทถอด (ไม่ใช่ดูรอบเดียว)', async () => {
  const video = fakeVideo();
  const writer = fakeWriter();
  const r = await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 700, deps: { callVideo: video, writeSingleBody: writer, hasFfmpeg: async () => false } });
  assert.equal(r.ok, true);
  assert.equal(video.calls.length, 1);
  assert.ok(/งานนี้คือ "ถอด"/.test(video.calls[0].prompt));
  assert.equal(writer.calls.length, 1);
  assert.ok(r.insight.single.degradations.some((d) => d.type === 'no-ffmpeg-whole-pass'));
});

test('ล้ม: Gemini ดูไม่สำเร็จ = ok:false ไม่เสียโทเคน · ตอบไม่มีเนื้อ = WRITER_BAD_OUTPUT พร้อม spentTokens', async () => {
  const r = await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 60, deps: { callVideo: fakeVideo({ fail: () => true }), writeSingleBody: fakeWriter() } });
  assert.equal(r.ok, false);
  assert.equal(r.errorType, 'BUSY');
  assert.equal(r.spentTokens, 0);

  const r2 = await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 60, deps: { callVideo: fakeVideo({ data: () => ({ headline: 'มีแต่พาดหัว' }) }), writeSingleBody: fakeWriter() } });
  assert.equal(r2.ok, false);
  assert.equal(r2.errorType, 'WRITER_BAD_OUTPUT');
  assert.equal(r2.spentTokens, 1300, 'จ่ายไปแล้ว — ผู้เรียกต้องไม่ลองใหม่อัตโนมัติ');
});

test('สวิตช์ถอย full: คลิปสั้นกลับเป็นถอดบท → คำสั่งเขียนเดิม', async () => {
  const video = fakeVideo();
  const writer = fakeWriter();
  const r = await runClipSinglePipeline({ style: 'full', type: 'tiktok', videoBuffer: buf(50_000), durationSec: 60, deps: { callVideo: video, writeSingleBody: writer } });
  assert.equal(r.ok, true);
  assert.ok(/งานนี้คือ "ถอด"/.test(video.calls[0].prompt));
  assert.equal(writer.calls.length, 1);
  assert.ok(writer.calls[0].prompt.includes('คุณคือบรรณาธิการข่าวไทย'), 'ทางเดิมใช้คำสั่งเขียน 25 ต.ค.');
  assert.equal(writer.calls[0].systemPrompt, undefined);
  assert.equal(r.insight.promptRev, SINGLE_REV);
  assert.equal(r.insight.single.style, 'full');
});

test('ตัวตรวจไม่มีบทถอด: ไม่ติดธงชื่อ/ตัวเลข/ความครบผิด ๆ · ขึ้น "ยังไม่ได้เทียบ" ทุกใบ · "เธอ" ต้องเช็คเว้นแคปชั่นบอกเพศ', () => {
  const draft = { headline: 'ลุงสมชายบริจาค 100 ล้าน', body: 'ลุงสมชายบริจาคเงิน 100 ล้านบาท\n\nลุงบอกว่า "อยากให้เด็กได้เรียน" และ "ทำแล้วสบายใจมาก"', names: ['สมชาย ใจดี'] };
  const a = checkSingleBody(draft, { segments: [], caption: '', noTranscript: true });
  assert.deepEqual(a.checks.map((c) => c.kind), ['unverified']);
  assert.ok(a.checks[0].text.includes('2 จุด') && a.checks[0].text.includes('ตัวเลข'));
  assert.equal(a.stats.noTranscript, true);
  assert.equal(a.body, draft.body, 'ไม่มีบทถอด = ห้ามแก้เนื้อ');

  // ★ ผู้ตรวจอิสระ 28 ต.ค.: ไม่มีคำพูดก็ต้องขึ้นจุดเช็ค (ไม่งั้นหน้าจอขึ้น "✓ ไม่พบจุดที่ต้องเช็ค" ทั้งที่ยังไม่ได้เทียบ)
  const none = checkSingleBody({ headline: 'ข่าว', body: 'ลุงขายของริมทาง 30 ปี' }, { segments: [], noTranscript: true });
  assert.deepEqual(none.checks.map((c) => c.kind), ['unverified']);
  assert.ok(none.checks[0].text.includes('ชื่อและตัวเลข') && !none.checks[0].text.includes('จุด)'));

  const she = { headline: 'ข่าว', body: 'เธอเดินออกจากบ้านตอนเช้า' };
  assert.deepEqual(checkSingleBody(she, { segments: [], caption: 'คลิปเด็กชาย', noTranscript: true }).checks.map((c) => c.kind), ['unverified', 'gender']);
  assert.deepEqual(checkSingleBody(she, { segments: [], caption: 'แม่ค้าผู้หญิงสู้ชีวิต', noTranscript: true }).checks.map((c) => c.kind), ['unverified']);

  // ทิศกลับ: ไม่ส่ง noTranscript = ด่านเดิมทำงาน (ไม่มีบทถอดจึงติดธงคำพูด/ตัวเลข/ชื่อ)
  const old = checkSingleBody(draft, { segments: [], caption: '' });
  assert.ok(old.checks.some((c) => c.kind === 'number') && old.checks.some((c) => c.kind === 'name'));
});

test('ล็อกสูตรห้องทดลอง: คำสั่งดูรอบเดียวต้องตรงกับห้องทดลองทุกตัวอักษร (แก้ = ต้องทดลองซ้ำแล้วอัปเดตค่านี้)', () => {
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  // ค่าจาก rawlab/prompts.mjs buildVariantPrompt('concise', …) 28 ต.ค. 69
  assert.equal(sha(buildConcisePassPrompt({ platform: 'tiktok', durationSec: 95, caption: 'แคปชั่นทดสอบ #ข่าว' })), '1a0d39199ba100d2eae8abf443ad03cd1f638d532c0af5d3d1dfb6ae61ef1ecd');
  assert.equal(sha(buildConcisePassPrompt({ platform: 'youtube', durationSec: 180, caption: '' })), 'c2fbbf329f7cf1c621c04680b385a82e9c81b8e3ae732453f83cba36a8d56939');
  // คลิปยาวไม่ได้ล็อก แต่ต้องคงกฎเดิมที่สูตรห้องทดลองไม่มี (ผู้ตรวจอิสระ 28 ต.ค.)
  const w = buildConciseWriterPrompt({ transcriptBlock: 'x' });
  assert.ok(w.includes('ห้ามคำนวณหรือปัดตัวเลขใหม่') && w.includes('ราคา โปรโมชัน'));
});

test('ใบเทียบโมเดล (o.model): คลิปสั้นดูรอบเดียวด้วยรุ่นที่ขอจริง', async () => {
  const video = fakeVideo();
  const r = await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 60, model: 'gemini-3.7-flash', deps: { callVideo: video, writeSingleBody: fakeWriter() } });
  assert.equal(r.ok, true);
  assert.equal(video.calls[0].model, 'gemini-3.7-flash');
  assert.equal(r.insight.single.watchModel, 'gemini-3.7-flash');
});

test('ไม่รู้ความยาวแล้วพบทีหลังว่าเกิน 8 นาที: จดการลดเกรด + จุดเช็คความครบ (ไม่ทำเงียบ)', async () => {
  const video = fakeVideo({ data: () => ({ ...DRAFT, durationSec: 900 }) });
  const r = await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 0, deps: { callVideo: video, writeSingleBody: fakeWriter(), probeBufferDurationSec: async () => 0 } });
  assert.equal(r.ok, true);
  assert.equal(r.insight.clipDurationSec, 900);
  assert.ok(r.insight.single.degradations.some((d) => d.type === 'long-clip-single-pass'));
  assert.ok(r.insight.checks.some((c) => c.kind === 'coverage' && c.text.includes('15:00 นาที (เกิน 8 นาที)')));
});

test('หน้าจอ: ใบดูรอบเดียวไม่ขึ้นติ๊กถูก "ไม่พบจุดที่ต้องเช็ค" · ป้าย "ยังไม่ได้เทียบ"', async () => {
  const video = fakeVideo({ data: () => ({ headline: 'ต๋อยเผยต้นทุนรายการ', body: 'ต๋อย ไตรภพ ระบุต้นทุนตอนละ 700,000 บาท แต่ขายโฆษณาได้ 60,000 บาท' }) });
  const r = await runClipSinglePipeline({ type: 'meta', videoBuffer: buf(50_000), durationSec: 152, deps: { callVideo: video, writeSingleBody: fakeWriter() } });
  const view = cardView({ insight: r.insight });
  assert.equal(view.legacy, false);
  assert.equal(view.checks.length, 1, 'ต้องมีจุดเช็คอย่างน้อย 1 จุด — หน้าจอขึ้นติ๊กถูกเมื่อ checks ว่าง');
  assert.equal(CHECK_KIND_LABEL[view.checks[0].kind], 'ยังไม่ได้เทียบ');
});

test('writeSingleBody: ค่าย Claude ได้ systemPrompt ที่ส่งมาจริง · ไม่ส่ง = คำสั่งเดิม', async () => {
  const seen = [];
  const callClaude = async (o) => { seen.push(o.systemPrompt); return { headline: 'ก', body: 'ข' }; };
  const writer = { kind: 'claude', model: 'claude-opus-4-8', effort: 'medium' };
  assert.equal((await writeSingleBody({ prompt: 'p', writer, systemPrompt: CONCISE_WRITER_SYSTEM, deps: { callClaude } })).ok, true);
  await writeSingleBody({ prompt: 'p', writer, deps: { callClaude } });
  assert.deepEqual(seen, [CONCISE_WRITER_SYSTEM, SINGLE_WRITER_SYSTEM]);
});

// ── ตัวเรียก Gemini: ส่งระดับการคิดถึง API เฉพาะเมื่อขอ ──
const ORIGINAL_FETCH = globalThis.fetch;
after(() => { globalThis.fetch = ORIGINAL_FETCH; });

test('callClipGeminiVideo: thinkingLevel ถึงคำขอจริง · ไม่ส่ง/ค่าแปลก = ไม่มี thinkingConfig (ทางเดิม)', async () => {
  const saved = { k: process.env.GEMINI_VIDEO_API_KEY, s: process.env.CLIP_SAFE_TEXT, f: process.env.CLIP_GEMINI_FALLBACK_MODELS };
  process.env.GEMINI_VIDEO_API_KEY = 'test-key';
  process.env.CLIP_SAFE_TEXT = '0';
  delete process.env.CLIP_GEMINI_FALLBACK_MODELS;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"headline":"ก","body":"ข"}' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }) };
  };
  try {
    const base = { youtubeUrl: 'https://www.youtube.com/watch?v=abcdefghijk', prompt: 'ทดสอบ', model: 'gemini-3.8-flash', fallbackModels: [] };
    assert.equal((await callClipGeminiVideo({ ...base, thinkingLevel: 'high' })).ok, true);
    const plain = await callClipGeminiVideo(base);
    const bad = await callClipGeminiVideo({ ...base, thinkingLevel: 'สูงสุด' });
    await callClipGeminiVideo({ ...base, thinkingLevel: ' HIGH ' });
    assert.deepEqual(bodies[0].generationConfig.thinkingConfig, { thinkingLevel: 'high' });
    assert.equal(bodies[1].generationConfig.thinkingConfig, undefined);
    assert.equal(bodies[2].generationConfig.thinkingConfig, undefined);
    assert.deepEqual(bodies[3].generationConfig.thinkingConfig, { thinkingLevel: 'high' }, 'พิมพ์ตัวใหญ่/เว้นวรรคยังได้ระดับคิด');
    assert.equal(bodies[1].generationConfig.responseMimeType, 'application/json');
    assert.ok(bad.receipt.degradations.some((d) => d.type === 'thinking-level-ignored'), 'ค่าที่ไม่รู้จักต้องถูกจดไว้ ไม่หายเงียบ');
    assert.ok(!plain.receipt.degradations.some((d) => d.type === 'thinking-level-ignored'));
  } finally {
    for (const [k, v] of [['GEMINI_VIDEO_API_KEY', saved.k], ['CLIP_SAFE_TEXT', saved.s], ['CLIP_GEMINI_FALLBACK_MODELS', saved.f]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
