/**
 * ★ 10 พ.ย. 69 — โพสต์ภาพสไลด์ TikTok (/photo/) · เคสตำรวจน๊อต (เจ้าของสั่ง "แก้เลย")
 *   เดิม: tikwm ให้ images[] + play = ไฟล์เพลง → ระบบส่งเพลงให้ Gemini "ดูคลิป" → แต่งภาพขึ้นเอง (Ford Mustang ดำ · จริง = เบนซ์ขาว)
 *   ใหม่: โหลดภาพทุกใบตามลำดับ + เสียงประกอบ → แนบให้ Gemini ดูทีละภาพ · ไฟล์เสียงล้วนห้ามส่งให้ "ดูคลิป"
 *   ไม่ยิง AI จริง (ตัวแทนทั้งหมด)
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { downloadTiktokSlides, isTiktokPhotoUrl, SLIDES_MAX, sniffImageType, looksAudioOnlyWatch } from '../src/lib/services/clipSingle/slides.js';
import { runClipSinglePipeline } from '../src/lib/services/clipSingle/pipeline.js';
import { buildSlideshowPassPrompt, SLIDESHOW_REV } from '../src/lib/services/clipSingle/prompts.js';
import { callClipGeminiVideo } from '../src/lib/services/clipBrain/clipGeminiVideo.js';
import { cardView, CHECK_KIND_LABEL } from '../src/app/clip-transcript/ui/statusMeta.js';

delete process.env.CLIP_RAW_STYLE;
const ROUTE_SRC = readFileSync(new URL('../src/app/api/clip-transcript/insight/route.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** fetch ปลอม: แผนที่ url → { type, bytes, ok } */
function fakeFetch(map) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const r = map[url];
    if (!r) throw new Error('network');
    return {
      ok: r.ok !== false,
      status: r.ok === false ? 404 : 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? r.type : null) },
      // ภาพปลอมมีหัวไฟล์ JPEG จริง (ตัวโหลดไม่เชื่อ content-type อย่างเดียว) · ไบต์ที่ 4 = เลขภาพ ใช้เช็คลำดับ
      arrayBuffer: async () => (String(r.type).startsWith('image/') ? Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(r.bytes - 4, r.fill ?? 7)]) : Buffer.alloc(r.bytes, r.fill ?? 7)),
    };
  };
  fn.calls = calls;
  return fn;
}
const img = (n, bytes = 5000) => ({ [`https://cdn/img${n}.jpeg`]: { type: 'image/jpeg', bytes, fill: n } });
const urls = (n) => Array.from({ length: n }, (_, i) => `https://cdn/img${i + 1}.jpeg`);

test('isTiktokPhotoUrl: จับเฉพาะลิงก์โพสต์ภาพ TikTok', () => {
  assert.equal(isTiktokPhotoUrl('https://www.tiktok.com/@notwtf/photo/7703982250454502708?_r=1'), true);
  assert.equal(isTiktokPhotoUrl('https://www.tiktok.com/@notwtf/video/7620366892632460564'), false);
  assert.equal(isTiktokPhotoUrl('https://evil.example/@x/photo/123'), false);
  assert.equal(isTiktokPhotoUrl('ไม่ใช่ลิงก์'), false);
});

test('downloadTiktokSlides: เรียงตามโพสต์ · ภาพที่โหลดไม่ได้นับเป็นภาพขาด · ได้เสียงประกอบเมื่อเป็น audio/*', async () => {
  const map = { ...img(1), ...img(2), ...img(4), 'https://cdn/img3.jpeg': { type: 'text/html', bytes: 3000 }, 'https://cdn/a.mp3': { type: 'audio/mpeg', bytes: 50000 } };
  const r = await downloadTiktokSlides(urls(4), 'https://cdn/a.mp3', { fetch: fakeFetch(map), sharp: null });
  assert.equal(r.total, 4);
  assert.equal(r.images.length, 3);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.images.map((p) => p.buffer[4]), [1, 2, 4], 'ลำดับภาพต้องตรงกับโพสต์');
  assert.ok(r.images.every((p) => p.mimeType === 'image/jpeg'));
  assert.equal(r.audio.mimeType, 'audio/mp3', 'audio/mpeg → ชื่อชนิดที่ Gemini รับ');
  assert.deepEqual(r.missingNos, [3]);
});

test('downloadTiktokSlides: โหลดไม่ได้สักภาพ = ข้อความชั่วคราว ("แน่น" ให้ worker ลองใหม่) · ไม่มีเสียงก็ดูภาพได้', async () => {
  await assert.rejects(downloadTiktokSlides(urls(3), '', { fetch: fakeFetch({}), sharp: null }), /แน่นชั่วคราว/);
  const r = await downloadTiktokSlides(urls(1), 'https://cdn/x.mp4', { fetch: fakeFetch({ ...img(1), 'https://cdn/x.mp4': { type: 'video/mp4', bytes: 50000 } }), sharp: null });
  assert.equal(r.audio, null, 'ไฟล์ที่ไม่ใช่เสียงห้ามแนบเป็นเสียงประกอบ');
});

test('downloadTiktokSlides: ย่อภาพด้วย resize ธรรมดา · รวมเกินงบย่อรอบสอง · ยังเกินตัดภาพท้ายและนับเป็นภาพขาด · เพดาน 35 ภาพ', async () => {
  const sizes = [];
  const fakeSharp = (b) => {
    const chain = { rotate: () => chain, resize: (o) => { sizes.push(o.width); return chain; }, flatten: () => chain, jpeg: () => chain, toBuffer: async () => Buffer.alloc(o2size(b), 9) };
    return chain;
  };
  const o2size = () => (sizes.at(-1) === 1536 ? 3 * 1024 * 1024 : 2 * 1024 * 1024);
  const map = Object.assign({}, ...Array.from({ length: 8 }, (_, i) => img(i + 1)));
  const r = await downloadTiktokSlides(urls(8), '', { fetch: fakeFetch(map), sharp: fakeSharp });
  assert.ok(sizes.includes(1536) && sizes.includes(1024), 'ต้องลองย่อ 1536 ก่อนแล้ว 1024');
  assert.ok(r.images.reduce((s, p) => s + p.buffer.length, 0) <= 12 * 1024 * 1024);
  assert.equal(r.images.length, 6);
  assert.equal(r.skipped, 2);
  const many = await downloadTiktokSlides(urls(40), '', { fetch: fakeFetch(Object.assign({}, ...Array.from({ length: 40 }, (_, i) => img(i + 1)))), sharp: null });
  assert.equal(many.images.length, SLIDES_MAX);
  assert.equal(many.total, 40);
});

/** ตัวแทน Gemini */
function fakeVideo(data) {
  const calls = [];
  const fn = async (opts) => {
    calls.push(opts);
    await opts.onUsage?.({ inputTokens: 1000, outputTokens: 300, totalTokens: 1300 });
    return { ok: true, receipt: { elapsedMs: 10, model: opts.model }, data };
  };
  fn.calls = calls;
  return fn;
}
const DRAFT = { headline: 'ตำรวจน๊อตซื้อเบนซ์มือสอง', body: 'ตำรวจน๊อตขายซีวิคแล้วซื้อเบนซ์มือสอง "ล้านนิดๆ"\n\nป้ายทะเบียน 130,000 บาท' };
const slidesOf = (n, { audio = true, total = n } = {}) => ({
  images: Array.from({ length: n }, (_, i) => ({ mimeType: 'image/jpeg', buffer: Buffer.alloc(2000, i + 1) })),
  audio: audio ? { mimeType: 'audio/mpeg', buffer: Buffer.alloc(3000, 0) } : null,
  total, skipped: total - n,
});

test('ท่อหลัก: โพสต์ภาพสไลด์ = แนบภาพทุกใบตามลำดับ + เสียงท้ายสุด · คำสั่งภาพสไลด์ · ไม่ต้องมีไฟล์วิดีโอ', async () => {
  const video = fakeVideo(DRAFT);
  const r = await runClipSinglePipeline({ url: 'https://www.tiktok.com/@notwtf/photo/1', type: 'tiktok', videoBuffer: null, caption: 'ไปรับลูกชายกันครับ', slides: slidesOf(25), deps: { callVideo: video } });
  assert.equal(r.ok, true, r.error);
  assert.equal(video.calls.length, 1, 'ดูรอบเดียว');
  const c = video.calls[0];
  assert.equal(c.mediaParts.length, 26);
  assert.deepEqual(c.mediaParts.slice(0, 25).map((p) => p.buffer[0]), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal(c.mediaParts.at(-1).mimeType, 'audio/mpeg');
  assert.equal(c.videoBuffer, undefined);
  assert.equal(c.youtubeUrl, undefined);
  assert.match(c.prompt, /ภาพสไลด์/);
  assert.match(c.prompt, /ภาพนิ่ง 25 ภาพ/);
  assert.match(c.prompt, /ห้ามบรรยายสิ่งที่ไม่เห็นในภาพ/);
  assert.match(c.prompt, /ไปรับลูกชายกันครับ/, 'แคปชั่นต้องถึงคำสั่ง');
  assert.equal(c.thinkingLevel, 'high');
  assert.equal(r.insight.source, 'slideshow');
  assert.equal(r.insight.promptRev, SLIDESHOW_REV);
  assert.equal(r.insight.single.writer.kind, 'gemini-slides');
  assert.deepEqual(r.insight.single.slides, { count: 25, total: 25, audio: true, skipped: 0 });
  assert.ok(r.insight.checks.some((x) => x.kind === 'slideshow'));
  assert.ok(!r.insight.checks.some((x) => x.kind === 'coverage'), 'ภาพครบ = ไม่ติดจุดเช็คความครบ');
  assert.equal(r.insight.body, DRAFT.body);
});

test('ท่อหลัก: ภาพขาดบางใบ = บอกในคำสั่ง + ติดจุดเช็คความครบ + จดการลดเกรด · ไม่มีเสียงไม่แนบ', async () => {
  const video = fakeVideo(DRAFT);
  const r = await runClipSinglePipeline({ url: 'u', type: 'tiktok', slides: slidesOf(20, { audio: false, total: 25 }), deps: { callVideo: video } });
  assert.equal(r.ok, true);
  assert.equal(video.calls[0].mediaParts.length, 20);
  assert.match(video.calls[0].prompt, /โพสต์มี 25 ภาพ แนบได้ 20 ภาพ/);
  assert.doesNotMatch(video.calls[0].prompt, /เสียงประกอบ 1 ไฟล์/);
  assert.ok(r.insight.checks.some((x) => x.kind === 'coverage' && /20 จาก 25/.test(x.text)));
  assert.ok(r.insight.single.degradations.some((d) => d.type === 'slides-missing'));
});

test('ท่อหลัก: ภาพว่าง = ล้มก่อนยิง AI · Gemini ล้ม = ok:false', async () => {
  const video = fakeVideo(DRAFT);
  const r0 = await runClipSinglePipeline({ url: 'u', type: 'tiktok', slides: { images: [], audio: null, total: 3 }, deps: { callVideo: video } });
  assert.equal(r0.ok, false);
  assert.equal(r0.errorType, 'BAD_INPUT');
  assert.equal(video.calls.length, 0);
  const bad = async () => ({ ok: false, errorType: 'BUSY', error: 'แน่น', receipt: {} });
  const r1 = await runClipSinglePipeline({ url: 'u', type: 'tiktok', slides: slidesOf(3), deps: { callVideo: bad } });
  assert.equal(r1.ok, false);
  assert.equal(r1.errorType, 'BUSY');
});

test('ไม่มี slides = ทางเดิม (คลิปวิดีโอไม่ถูกแตะ) · สูตรคำสั่งคลิปที่ล็อกไว้ไม่เปลี่ยน', async () => {
  const video = fakeVideo(DRAFT);
  const r = await runClipSinglePipeline({ url: 'u', type: 'tiktok', videoBuffer: Buffer.alloc(20000, 1), durationSec: 26, deps: { callVideo: video } });
  assert.equal(r.ok, true);
  assert.ok(Buffer.isBuffer(video.calls[0].videoBuffer));
  assert.equal(video.calls[0].mediaParts, undefined);
  assert.notEqual(r.insight.source, 'slideshow');
  assert.match(video.calls[0].prompt, /คุณคือคนที่เพิ่งนั่งดูคลิปนี้จบ/);
  assert.doesNotMatch(buildSlideshowPassPrompt({ count: 3, total: 3 }), /เสียงประกอบ 1 ไฟล์/);
});

test('callClipGeminiVideo: mediaParts → parts ภาพ/เสียงตามลำดับ + ข้อความท้าย · เสียงล้วนไม่ยิง · เกินเพดานไม่ยิง', async () => {
  const origFetch = globalThis.fetch;
  const origKey = process.env.GEMINI_VIDEO_API_KEY;
  const origSafe = process.env.CLIP_SAFE_TEXT;
  process.env.GEMINI_VIDEO_API_KEY = 'test-key';
  process.env.CLIP_SAFE_TEXT = '0';
  const bodies = [];
  globalThis.fetch = async (_u, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"headline":"h","body":"b"}' }] } }] }) };
  };
  after(() => {
    globalThis.fetch = origFetch;
    if (origKey === undefined) delete process.env.GEMINI_VIDEO_API_KEY; else process.env.GEMINI_VIDEO_API_KEY = origKey;
    if (origSafe === undefined) delete process.env.CLIP_SAFE_TEXT; else process.env.CLIP_SAFE_TEXT = origSafe;
  });
  const parts = [{ mimeType: 'image/jpeg', buffer: Buffer.from('AAAA') }, { mimeType: 'image/png', buffer: Buffer.from('BBBB') }, { mimeType: 'audio/mpeg', buffer: Buffer.from('CCCC') }];
  const ok = await callClipGeminiVideo({ prompt: 'ดูภาพ', mediaParts: parts, model: 'gemini-3.8-flash', fallbackModels: [], maxAttempts: 1 });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.receipt.source, 'media-parts');
  const sent = bodies[0].contents[0].parts;
  assert.equal(sent.length, 4);
  assert.deepEqual(sent.slice(0, 3).map((p) => p.inlineData.mimeType), ['image/jpeg', 'image/png', 'audio/mpeg']);
  assert.equal(sent[0].inlineData.data, Buffer.from('AAAA').toString('base64'));
  assert.equal(sent[3].text, 'ดูภาพ');

  const audioOnly = await callClipGeminiVideo({ prompt: 'x', mediaParts: [parts[2]], fallbackModels: [], maxAttempts: 1 });
  assert.equal(audioOnly.ok, false);
  assert.equal(audioOnly.errorType, 'BAD_INPUT');
  const junk = await callClipGeminiVideo({ prompt: 'x', mediaParts: [parts[0], { mimeType: 'text/html', buffer: Buffer.from('x') }], fallbackModels: [], maxAttempts: 1 });
  assert.equal(junk.errorType, 'BAD_INPUT', 'ชิ้นที่ไม่ใช่ภาพ/เสียงห้ามหลุดเงียบ');
  const huge = await callClipGeminiVideo({ prompt: 'x', mediaParts: [{ mimeType: 'image/jpeg', buffer: Buffer.alloc(15 * 1024 * 1024) }], fallbackModels: [], maxAttempts: 1 });
  assert.equal(huge.errorType, 'TOO_LARGE');
  assert.equal(bodies.length, 1, 'กรณีถูกปัดต้องไม่ยิง Gemini');
});

test('ประตู route: ตัวโหลด TikTok แยกโพสต์ภาพ · กันไฟล์เสียงล้วน · ส่งภาพถึงท่อหลัก · คลังไม่คืนใบสไลด์ที่ถอดก่อนแก้', () => {
  const tk = ROUTE_SRC.slice(ROUTE_SRC.indexOf('async function downloadTiktokBuffer'), ROUTE_SRC.indexOf('async function downloadMetaBuffer'));
  assert.ok(tk.indexOf('downloadTiktokSlides(images, playUrl)') > 0, 'โพสต์ภาพต้องโหลดภาพทุกใบ');
  assert.ok(tk.indexOf('downloadTiktokSlides(images, playUrl)') < tk.indexOf('const vres = await fetch(playUrl'), 'ต้องเช็คโพสต์ภาพก่อนโหลด play');
  assert.match(tk, /vtype\.startsWith\('audio\/'\)\) throw new Error\('tikwm ได้แค่ไฟล์เสียง[^']*กดใหม่ไม่ช่วย'\)/, 'ไฟล์เสียงล้วนต้องหยุด (ถาวร)');
  assert.match(ROUTE_SRC, /slides: meta\.slides \|\| null/);
  assert.match(ROUTE_SRC, /slides: src\.slides \|\| null/);
  assert.match(ROUTE_SRC, /!\(isTiktokPhotoUrl\(url\) && c\.insight\?\.source !== 'slideshow'\)/);
});

test('หน้าจอ: ป้ายจุดเช็ค "โพสต์ภาพสไลด์"', () => {
  assert.equal(CHECK_KIND_LABEL.slideshow, 'โพสต์ภาพสไลด์');
  const v = cardView({ insight: { engine: 'clip-single', headline: 'h', body: 'b', checks: [{ level: 'check', kind: 'slideshow', text: 'โพสต์ภาพสไลด์ 25 ภาพ' }] } });
  assert.ok(v);
});

// ═══ ผู้ตรวจอิสระ 10 พ.ย. รอบ 1 ═══
const JPEG = (n = 1, len = 3000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(len, n)]);
const HEIC = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(3000, 2)]);
const GIF = () => Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(3000, 3)]);
function bytesFetch(map) {
  return async (url) => {
    const r = map[url];
    if (!r) throw new Error('network');
    return { ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? r.type : null) }, arrayBuffer: async () => r.body };
  };
}

test('sniffImageType: ดูชนิดจากหัวไฟล์จริง', () => {
  assert.equal(sniffImageType(JPEG()), 'image/jpeg');
  assert.equal(sniffImageType(HEIC()), 'image/heic');
  assert.equal(sniffImageType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(10)])), 'image/png');
  assert.equal(sniffImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(10)])), 'image/webp');
  assert.equal(sniffImageType(GIF()), '');
  assert.equal(sniffImageType(Buffer.from('<html>error</html>')), '');
});

test('sharp อ่านไม่ได้: ห้ามส่งไบต์ที่ติดป้ายผิด — ชนิดที่ Gemini รับใช้ชนิดจริง · ชนิดอื่นทิ้งเป็นภาพขาด · octet-stream ที่เป็น JPEG จริงใช้ได้', async () => {
  const brokenSharp = () => { throw new Error('heif: Unsupported compression'); };
  const map = {
    'https://cdn/img1.jpeg': { type: 'application/octet-stream', body: JPEG(1) },
    'https://cdn/img2.jpeg': { type: 'image/heic', body: HEIC() },
    'https://cdn/img3.jpeg': { type: 'image/gif', body: GIF() },
  };
  const r = await downloadTiktokSlides(urls(3), '', { fetch: bytesFetch(map), sharp: brokenSharp });
  assert.deepEqual(r.images.map((p) => p.mimeType), ['image/jpeg', 'image/heic'], 'ภาพ heic ต้องติดป้าย heic ไม่ใช่ jpeg');
  assert.deepEqual(r.missingNos, [3], 'gif ที่ย่อไม่ได้และ Gemini ไม่รับ = ภาพขาด');
  const none = await downloadTiktokSlides(urls(1), '', { fetch: bytesFetch({ 'https://cdn/img1.jpeg': { type: 'image/gif', body: GIF() } }), sharp: null })
    .then(() => 'resolved', (e) => e.message);
  assert.match(none, /อ่านไม่ได้ทุกภาพ — กดใหม่ไม่ช่วย/, 'ทุกภาพเป็นชนิดที่อ่านไม่ได้ = ถาวร (ไม่วนลองซ้ำ)');
});

test('ภาพย่อด้วย sharp ตัวจริง: ภาพโปร่งใสรองพื้นขาว (ตัวหนังสือดำไม่หาย) · ผลเป็น JPEG', async (t) => {
  let sharp;
  try { sharp = (await import('sharp')).default; } catch { t.skip('ไม่มี sharp'); return; }
  const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const r = await downloadTiktokSlides(urls(1), '', { fetch: bytesFetch({ 'https://cdn/img1.jpeg': { type: 'image/png', body: Buffer.concat([png, Buffer.alloc(2000)]) } }) });
  assert.equal(r.images[0].mimeType, 'image/jpeg');
  const { channels } = await sharp(r.images[0].buffer).stats();
  assert.ok(channels[0].mean > 200, `พื้นโปร่งใสต้องเป็นขาว (ได้ค่าเฉลี่ย ${channels[0].mean})`);
});

test('เสียงประกอบ: รับเฉพาะชนิดที่ Gemini รับ · m4a/mp4 ทิ้งเสียงแล้วดูภาพต่อ', async () => {
  const map = { 'https://cdn/img1.jpeg': { type: 'image/jpeg', body: JPEG() }, 'https://cdn/a.m4a': { type: 'audio/x-m4a', body: Buffer.alloc(5000) }, 'https://cdn/b.wav': { type: 'audio/wav; charset=binary', body: Buffer.alloc(5000) } };
  const r1 = await downloadTiktokSlides(urls(1), 'https://cdn/a.m4a', { fetch: bytesFetch(map), sharp: null });
  assert.equal(r1.audio, null);
  assert.equal(r1.images.length, 1);
  const r2 = await downloadTiktokSlides(urls(1), 'https://cdn/b.wav', { fetch: bytesFetch(map), sharp: null });
  assert.equal(r2.audio.mimeType, 'audio/wav');
});

test('คำสั่งภาพสไลด์: บอกตำแหน่งภาพที่ขาด · อธิบายคำว่า "คลิป" ในกฎร่วม', async () => {
  const p = buildSlideshowPassPrompt({ count: 23, total: 25, missingNos: [2, 7] });
  assert.match(p, /ภาพที่ 2, 7 ในโพสต์โหลดไม่ได้/);
  assert.match(p, /คำว่า "คลิป" ในข้อมูลและหลักการเขียนด้านล่าง หมายถึงโพสต์ภาพนี้/);
  const video = fakeVideo(DRAFT);
  await runClipSinglePipeline({ url: 'u', type: 'tiktok', slides: { ...slidesOf(3, { total: 4 }), missingNos: [4] }, deps: { callVideo: video } });
  assert.match(video.calls[0].prompt, /ภาพที่ 4 ในโพสต์โหลดไม่ได้/, 'ท่อหลักต้องส่งตำแหน่งภาพที่ขาดถึงคำสั่ง');
});

test('looksAudioOnlyWatch: ใบเก่าที่ Gemini ได้แค่เสียง (โทเคน VIDEO ~25/วิ) = คลังห้ามคืน · วิดีโอจริง (~91/วิ) ไม่โดน', () => {
  const rec = (vt, dur, extra = []) => ({ clipDurationSec: dur, single: { writer: { kind: 'gemini-video', usage: { promptTokensDetails: [{ modality: 'TEXT', tokenCount: 867 }, { modality: 'VIDEO', tokenCount: vt }, ...extra] } } } });
  assert.equal(looksAudioOnlyWatch(rec(1049, 42)), true, 'เคสตำรวจน๊อตจริง');
  assert.equal(looksAudioOnlyWatch(rec(2366, 26)), false, 'คลิปวิดีโอ 26 วิจริง');
  assert.equal(looksAudioOnlyWatch(rec(1049, 0)), false, 'ไม่รู้ความยาว = ไม่ตัดสิน');
  assert.equal(looksAudioOnlyWatch({ single: { writer: { kind: 'gemini-slides' } }, clipDurationSec: 0 }), false);
  assert.equal(looksAudioOnlyWatch({}), false);
  assert.ok(ROUTE_SRC.includes('&& !looksAudioOnlyWatch(c.insight))'), 'คลังต้องกรองใบเสียงล้วน');
});

test('ผู้ตรวจรอบ 2: HTML ที่ตอบ content-type image/jpeg ห้ามหลุดไปเป็นภาพ (sharp อ่านไม่ได้/ไม่มี sharp)', async () => {
  const html = Buffer.from('<html>' + 'x'.repeat(3000) + '</html>');
  const map = { 'https://cdn/img1.jpeg': { type: 'image/jpeg', body: html }, 'https://cdn/img2.jpeg': { type: 'image/jpeg', body: JPEG(2) } };
  for (const sharp of [null, () => { throw new Error('unsupported image format'); }]) {
    const r = await downloadTiktokSlides(urls(2), '', { fetch: bytesFetch(map), sharp });
    assert.equal(r.images.length, 1);
    assert.deepEqual(r.missingNos, [1]);
    assert.equal(r.images[0].buffer[0], 0xff);
  }
});
