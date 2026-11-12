/**
 * ★ 12 พ.ย. 69 — เนื้อข่าวเล่าต่อเนื่อง (ค่าเริ่มต้นใหม่ของการเขียนหลังถอดคลิป)
 *   เจ้าของ: "หลังถอดมาให้เรียงข้อความเป็นเนื้อข่าวเดียวกันแบบเข้าใจได้จริง ไม่แยกใจความให้สับสน และบรรยายข่าวที่ถอดมาได้ดีอ่านเข้าใจ"
 *   ห้องทดลอง 5 คลิปจริง: กรรมการปิดตาเลือกสูตรนี้เหนือร้อยแก้วกระชับ · รอบ 2 เพิ่มกฎความแม่น
 *   ถอย: CLIP_RAW_STYLE=concise · ไม่ยิง AI จริง (ตัวแทนทั้งหมด)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { runClipSinglePipeline, resolveRawStyle, DEFAULT_CONCISE_MODEL } from '../src/lib/services/clipSingle/pipeline.js';
import {
  buildNarrativePassPrompt, buildNarrativeWriterPrompt, buildNarrativeSlideshowPrompt, NARRATIVE_REV, NARRATIVE_WRITER_SYSTEM,
  buildConcisePassPrompt,
} from '../src/lib/services/clipSingle/prompts.js';

delete process.env.CLIP_RAW_STYLE;
delete process.env.CLIP_CONCISE_MODEL;
delete process.env.CLIP_CONCISE_EFFORT;

const buf = (n) => Buffer.alloc(n, 1);
const WATCH_DATA = { transcript: [{ t: '0:30', speaker: 'ลุงสมชาย', text: 'ผมขายก๋วยเตี๋ยวมาสามสิบปีแล้วครับ' }], keyPoints: ['ลุงขายก๋วยเตี๋ยว 30 ปี'] };
const DRAFT = { outline: ['ลุงเปิดร้าน', 'ลุงเล่าเรื่อง'], headline: 'ลุงสมชายขายก๋วยเตี๋ยว 30 ปี', body: 'ลุงสมชายขายก๋วยเตี๋ยวริมทางมา 30 ปี\n\nลุงบอกว่า "ผมขายก๋วยเตี๋ยวมาสามสิบปีแล้วครับ"' };
function fakeVideo() {
  const calls = [];
  const fn = async (opts) => {
    calls.push(opts);
    await opts.onUsage?.({ inputTokens: 1000, outputTokens: 300, totalTokens: 1300 });
    const isPass = /เนื้อข่าวออนไลน์/.test(opts.prompt) && !/งานนี้คือ "ถอด"/.test(opts.prompt);
    return { ok: true, receipt: { elapsedMs: 10, model: opts.model }, data: isPass ? DRAFT : WATCH_DATA };
  };
  fn.calls = calls;
  return fn;
}
function fakeWriter(draft = { ...DRAFT, names: ['ลุงสมชาย'] }) {
  const fn = async (o) => { fn.calls.push(o); return { ok: true, draft, model: 'gemini-3.8-flash', kind: 'gemini', elapsedMs: 3, tokensUsed: 500 }; };
  fn.calls = [];
  return fn;
}

test('สวิตช์: ไม่ตั้ง = เนื้อข่าวเล่าต่อเนื่อง · concise/full ถอยได้', () => {
  assert.equal(resolveRawStyle(), 'narrative');
  assert.equal(resolveRawStyle('concise'), 'concise');
  assert.equal(resolveRawStyle('full'), 'full');
  assert.equal(resolveRawStyle('narrative'), 'narrative');
});

test('คลิปสั้น: ดูรอบเดียวด้วยคำสั่งเนื้อข่าวเล่าต่อเนื่อง · ไม่เรียกคนเขียนแยก · rev ใหม่ · outline ไม่หลุดไปเป็นเนื้อ', async () => {
  const video = fakeVideo();
  const writer = fakeWriter();
  const r = await runClipSinglePipeline({ url: 'https://vt.tiktok.com/x/', type: 'tiktok', videoBuffer: buf(50_000), durationSec: 95, caption: 'ลุงสมชาย', deps: { callVideo: video, writeSingleBody: writer } });
  assert.equal(r.ok, true, r.error);
  assert.equal(video.calls.length, 1);
  assert.equal(writer.calls.length, 0);
  const c = video.calls[0];
  assert.equal(c.prompt, buildNarrativePassPrompt({ platform: 'tiktok', durationSec: 95, caption: 'ลุงสมชาย', wantDuration: false }));
  assert.equal(c.model, DEFAULT_CONCISE_MODEL);
  assert.equal(c.thinkingLevel, 'high');
  assert.equal(r.insight.promptRev, NARRATIVE_REV);
  assert.equal(r.insight.single.style, 'narrative');
  assert.equal(r.insight.body, DRAFT.body);
  assert.doesNotMatch(r.insight.body, /ช่วงที่ 1|ลุงเปิดร้าน/, 'โครงเรื่องใช้คิดก่อนเขียน ไม่ปนในเนื้อ');
  assert.deepEqual(r.insight.checks.map((x) => x.kind), ['unverified']);
});

test('ไม่รู้ความยาว: ขอ durationSec ในคำตอบเดียวกัน', async () => {
  const video = fakeVideo();
  await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 0, deps: { callVideo: video, probeBufferDurationSec: async () => 0 } });
  assert.match(video.calls[0].prompt, /"durationSec": ความยาวคลิปทั้งหมดเป็นวินาที/);
  assert.doesNotMatch(buildNarrativePassPrompt({ durationSec: 60 }), /"durationSec"/);
});

test('คลิปยาว: ถอดบทเดิม → คนเขียนเนื้อข่าวเล่าต่อเนื่องจากบทถอด (system ของสูตรใหม่ · ขอรายชื่อ)', async () => {
  const video = fakeVideo();
  const writer = fakeWriter();
  const cut = async (b, plan) => ({ ok: true, segments: plan.map((s) => ({ ...s, buffer: buf(20_000) })) });
  const r = await runClipSinglePipeline({ type: 'meta', videoBuffer: buf(30_000), durationSec: 1500, deps: { callVideo: video, writeSingleBody: writer, cutSegments: cut, hasFfmpeg: async () => true } });
  assert.equal(r.ok, true, r.error);
  assert.ok(video.calls.every((c) => /งานนี้คือ "ถอด"/.test(c.prompt)), 'คลิปยาวยังถอดบทด้วยคำสั่งเดิม');
  assert.equal(writer.calls.length, 1);
  assert.equal(writer.calls[0].systemPrompt, NARRATIVE_WRITER_SYSTEM);
  // ★ ผู้ตรวจอิสระ 12 พ.ย. ข้อ 1: เทียบคำสั่งตรงตัว (ข้อความที่เช็คด้านล่างมีในสูตรกระชับด้วย — สลับสูตรแล้วข้อสอบต้องตก)
  assert.match(writer.calls[0].prompt, /เนื้อข่าวออนไลน์/);
  assert.doesNotMatch(writer.calls[0].prompt, /ร้อยแก้วกระชับ|เรียงตามความสำคัญ/);
  assert.ok(writer.calls[0].prompt.includes('เขียนจากบทถอดด้านล่างเท่านั้น') && writer.calls[0].prompt.includes('ผมขายก๋วยเตี๋ยวมาสามสิบปีแล้วครับ'));
  assert.match(writer.calls[0].prompt, /"names"/);
  assert.match(writer.calls[0].prompt, /คลิปนี้ยาว ต้องครอบทุกเรื่องที่มีน้ำหนัก/);
  assert.equal(r.insight.promptRev, NARRATIVE_REV);
});

test('คำสั่ง: มีกฎเรียงเรื่อง + กฎความแม่นครบ (ที่มาของการแก้ — ห้ามหายเงียบ)', () => {
  for (const p of [buildNarrativePassPrompt({}), buildNarrativeWriterPrompt({ transcriptBlock: 'x' }), buildNarrativeSlideshowPrompt({ count: 2, total: 2 })]) {
    for (const must of [
      'เนื้อข่าวออนไลน์', 'ย่อหน้าละหนึ่งเรื่อง', 'ห้ามย้อนกลับไปเล่าเรื่องที่ผ่านไปแล้ว', 'คำเชื่อมธรรมดา', 'ห้ามคำเชื่อมแบบเอกสาร',
      'บอกว่าเป็นใคร/คืออะไรตอนเอ่ยถึงครั้งแรก', 'คำพูดตรงวางไว้ในช่วงของเรื่องที่พูดถึง', 'ห้ามปิดด้วยข้อคิด',
      'พูดแบบไม่แน่ใจหรือคาดเดา', 'ห้ามโยงเหตุกับผลเอง', 'เขียนแบบกะประมาณตามที่พูด', 'มีคนช่วย…', 'ห้ามเดาเพศ', 'วางโครงเรื่องก่อน',
      'ห้ามเปิดด้วยการบอกว่าใครมาให้สัมภาษณ์ เปิดใจ', // ★ ผู้ตรวจอิสระข้อ 2: กฎเจ้าของ (เคสบี วิลาวรรณ ขึ้นต้น "เปิดใจ" ในห้องทดลอง)
    ]) assert.ok(p.includes(must), `ขาด "${must}"`);
    assert.doesNotMatch(p, /เรียงตามความสำคัญ/, 'ต้นเหตุเดิมของการกระโดดเรื่องต้องไม่กลับมา');
    assert.doesNotMatch(p, /"บี/, 'ตัวอย่างห้ามใช้ชื่อคนจริง (ผู้ตรวจข้อ 4)');
  }
  assert.match(buildNarrativeWriterPrompt({ transcriptBlock: 'x' }), /ห้ามคำนวณตัวเลขใหม่/);
  assert.match(buildNarrativeWriterPrompt({ transcriptBlock: 'x' }), /ราคา โปรโมชัน/, 'คลิปยาวคงกฎตัดราคา/โปรโมชันแบบเดิม');
  assert.match(buildNarrativeSlideshowPrompt({ count: 2, total: 3, missingNos: [2] }), /ภาพที่ 2 ในโพสต์โหลดไม่ได้/);
  const sl = buildNarrativeSlideshowPrompt({ count: 2, total: 2, caption: 'แคป' });
  assert.match(sl, /ห้ามบรรยายสิ่งที่ไม่เห็นในภาพ/);
  // ★ ผู้ตรวจข้อ 3: คำของโพสต์ภาพต้องไม่ขัดกันเอง (ไม่มีจอ/ไม่มี "ได้ยิน" เป็นเงื่อนไขยกคำพูด · ไม่เรียกว่าคลิป)
  assert.doesNotMatch(sl, /ได้ยิน ขึ้นบนจอ|(ฟังไม่ชัด)|ข้อมูลคลิป:|แคปชั่นคลิป/);
  assert.match(sl, /ตรงทุกคำตามที่เขียนบนภาพหรือได้ยินในเสียงประกอบ/);
  assert.match(sl, /ข้อมูลโพสต์:/);
  assert.match(sl, /เรียงตามลำดับภาพในโพสต์/);
});

test('ล็อกสูตร: คำสั่งดูรอบเดียวตรงกับที่ทดลองกับคลิปจริง 12 พ.ย. ทุกตัวอักษร (แก้ = ทดลองซ้ำแล้วอัปเดตค่านี้) · สูตรกระชับเดิมไม่ถูกแตะ', () => {
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  assert.equal(sha(buildNarrativePassPrompt({ platform: 'tiktok', durationSec: 95, caption: 'แคปชั่นทดสอบ #ข่าว' })), '2cf38ec5c595dc5d9397395b42974ce318b887150ff6e7c6edf3d23f3580b95c');
  assert.equal(sha(buildNarrativePassPrompt({ platform: 'youtube', durationSec: 180, caption: '' })), 'b1716b992c969069a53fef6d4ad5d40b6f07422cb79e060afc2cbf4496f2e052');
  assert.equal(sha(buildConcisePassPrompt({ platform: 'tiktok', durationSec: 95, caption: 'แคปชั่นทดสอบ #ข่าว' })), '1a0d39199ba100d2eae8abf443ad03cd1f638d532c0af5d3d1dfb6ae61ef1ecd', 'สูตรถอย (กระชับ) ต้องเหมือนเดิม');
});

// ═══ 12 พ.ย. 69: ตัวกรองฝั่ง Google บล็อกคำขอ (เคสจริง: โพสต์ภาพตำรวจน๊อต + แคปชั่น "ไปรับลูกชาย…ซื้อมือสอง") ═══
test('callClipGeminiVideo: promptFeedback.blockReason = BLOCKED ยิงครั้งเดียว (เดิมตกเป็น EMPTY ยิงซ้ำ 3 รอบ)', async () => {
  const { callClipGeminiVideo } = await import('../src/lib/services/clipBrain/clipGeminiVideo.js');
  const saved = { f: globalThis.fetch, k: process.env.GEMINI_VIDEO_API_KEY };
  process.env.GEMINI_VIDEO_API_KEY = 'test-key';
  let n = 0;
  globalThis.fetch = async () => { n += 1; return { ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: { promptTokenCount: 29000, totalTokenCount: 29000 } }) }; };
  try {
    const r = await callClipGeminiVideo({ prompt: 'x', mediaParts: [{ mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 1]) }], model: 'gemini-3.8-flash', fallbackModels: [], maxAttempts: 3 });
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'BLOCKED');
    assert.equal(n, 1, 'คำขอที่ถูกบล็อกห้ามยิงซ้ำ (เสียค่าอินพุตเต็มทุกรอบ)');
  } finally {
    globalThis.fetch = saved.f;
    if (saved.k === undefined) delete process.env.GEMINI_VIDEO_API_KEY; else process.env.GEMINI_VIDEO_API_KEY = saved.k;
  }
});

function blockFirst() {
  const calls = [];
  const fn = async (opts) => {
    calls.push(opts);
    if (calls.length === 1) return { ok: false, errorType: 'BLOCKED', error: 'ถูกบล็อก', receipt: { elapsedMs: 5 } };
    await opts.onUsage?.({ inputTokens: 1000, outputTokens: 300, totalTokens: 1300 });
    return { ok: true, receipt: { elapsedMs: 10, model: opts.model }, data: DRAFT };
  };
  fn.calls = calls;
  return fn;
}

test('ถูกบล็อก (คลิปสั้น): ถอยร้อยแก้วกระชับหนึ่งครั้ง · rev บอกสูตรที่ใช้จริง · จดการลดเกรด', async () => {
  const { CONCISE_REV } = await import('../src/lib/services/clipSingle/prompts.js');
  const video = blockFirst();
  const r = await runClipSinglePipeline({ type: 'tiktok', videoBuffer: buf(50_000), durationSec: 60, caption: 'c', deps: { callVideo: video } });
  assert.equal(r.ok, true, r.error);
  assert.equal(video.calls.length, 2);
  assert.match(video.calls[0].prompt, /เนื้อข่าวออนไลน์/);
  assert.equal(video.calls[1].prompt, buildConcisePassPrompt({ platform: 'tiktok', durationSec: 60, caption: 'c', wantDuration: false }));
  assert.equal(r.insight.promptRev, CONCISE_REV);
  assert.ok(r.insight.single.degradations.some((d) => d.type === 'narrative-blocked-fallback'));
});

test('ถูกบล็อก (ภาพสไลด์): ถอยคำสั่งภาพสไลด์ 10 พ.ย. หนึ่งครั้ง · ล้มอย่างอื่นไม่ถอย', async () => {
  const { SLIDESHOW_REV, buildSlideshowPassPrompt } = await import('../src/lib/services/clipSingle/prompts.js');
  const slides = { images: [{ mimeType: 'image/jpeg', buffer: Buffer.alloc(2000, 1) }], audio: null, total: 1, missingNos: [] };
  const video = blockFirst();
  const r = await runClipSinglePipeline({ type: 'tiktok', caption: 'c', slides, deps: { callVideo: video } });
  assert.equal(r.ok, true, r.error);
  assert.equal(video.calls.length, 2);
  assert.equal(video.calls[1].prompt, buildSlideshowPassPrompt({ platform: 'tiktok', caption: 'c', count: 1, total: 1, hasAudio: false, missingNos: [] }));
  assert.equal(r.insight.promptRev, SLIDESHOW_REV);
  const busy = async () => ({ ok: false, errorType: 'BUSY', error: 'แน่น', receipt: {} });
  let n = 0;
  const r2 = await runClipSinglePipeline({ type: 'tiktok', caption: 'c', slides, deps: { callVideo: async (o) => { n += 1; return busy(o); } } });
  assert.equal(r2.ok, false);
  assert.equal(n, 1, 'ถอยเฉพาะตอนถูกบล็อก');
});
