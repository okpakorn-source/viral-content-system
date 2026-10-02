/**
 * 🧪 เคสล่มระบบถอดคลิป 30 ก.ย. 69 (pepedog89) — ข้อสอบพฤติกรรม 4 บั๊ก (ไม่ค้นคำในซอร์ส)
 *   ข้อ 1 เครื่องยนต์ใหม่ต้องได้ไฟล์คลิปตัวเดียวกับเครื่องยนต์เดิม (โหลดครั้งเดียว) · >19MB ข้ามเครื่องยนต์ใหม่ · YouTube คงเดิม
 *   ข้อ 2 Files API รอประมวลผลตามเวลาจาก env · หมดเวลา = timeout + retrySafe · FAILED โยนทันที · error จาก generateContent ไม่ติดธง
 *   ข้อ 3 POST /insight คืน retrySafe:true เฉพาะ "ล้มก่อนจ่ายค่าโมเดล" และเครื่องยนต์ใหม่ยังไม่ใช้โทเคน · log worker ไม่บอก "กดใหม่ไม่ช่วย" ผิดเคส
 *   ข้อ 4 ลิงก์ซ้อน 2 รอบ/มีข้อความปน → ลิงก์แรกลิงก์เดียวที่ล้างแล้ว (คิว + ทุก route ที่รับลิงก์)
 *   รอบ 3: M1 yt-dlp ตัดสินถาวร/ชั่วคราวเอง · M2 โฟลเดอร์ชั่วคราวต่อการโหลด + เพดานเวลาจาก env · L2 tikwm จำกัดความถี่ = ชั่วคราว
 *          · L4 ข้อความ PROCESSING เป็นกลาง · L6 แกะลิงก์ห่อ l.facebook.com/lm.facebook.com/l.messenger.com
 *   รอบ 4: F1 rm โฟลเดอร์ชั่วคราวลองซ้ำเมื่อไฟล์ยังถูกถือ (EBUSY) · F2 ข้อความ PROCESSING ตาม retrySafe ที่ส่งจริง
 *          · F3 tikwm จำกัดความถี่แคบลง · F4 yt-dlp ตัดหัวบรรทัด/คำถาวรของ worker/เน็ต Windows-SSL
 *          · F5 ลิงก์ห่อ www./m.facebook.com/l.php + l.instagram.com · ถอด u ด้วย URLSearchParams · ลบพารามิเตอร์ตัวห่อ
 *          · F6 /api/clip-agent/result ค้นด้วยลิงก์ซ้อน/ห่อได้
 * เทคนิค: module.register data-URL loader แปลง @/ → src/ และ resolve โมดูลหนักไปเป็น data: module ของเทส
 *   (แบบเดียวกับ clip-agent-api / clip-editorial-raw) — โหลด route/lib ตัวจริงทั้งไฟล์
 * เวลา: timer จริงสั้นๆ เท่านั้น ไม่ unref · promise ที่อาจค้างครอบ settleWithin (บทเรียน CI node 22)
 * ข้อมูล: cwd ย้ายไปโฟลเดอร์ชั่วคราว (มี bin/yt-dlp.exe ปลอม) · store ทั้งหมดอยู่ในหน่วยความจำ — ไม่แตะ data/ จริง
 */
import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import { settleWithin } from './helpers/fake-deadline.mjs';

const MB = 1024 * 1024;
const FB_ONE = 'https://www.facebook.com/pepedog89/videos/1084395141170409';
const FB_TWICE = FB_ONE + FB_ONE; // ลิงก์จริงของใบงาน 15:04 ที่ถูกวางซ้อน 2 รอบติดกัน
const JSON_HEADERS = { 'content-type': 'application/json' };

// ── สภาพแวดล้อมชั่วคราว (สร้างใน before · คืนค่าทั้งหมดใน after — import ล้มก็ไม่ทิ้งโฟลเดอร์ค้าง) ──────
const originalCwd = process.cwd();
const SYSTEM_TMP = tmpdir(); // temp จริงของเครื่อง (จับไว้ก่อนเปลี่ยน env ข้างล่าง)
let tempRoot = '';
before(() => {
  tempRoot = mkdtempSync(join(SYSTEM_TMP, 'clip-outage-30sep-'));
  mkdirSync(join(tempRoot, 'bin'));
  writeFileSync(join(tempRoot, 'bin', 'yt-dlp.exe'), ''); // route เช็คแค่ว่ามีไฟล์ — การรันจริงถูก stub ที่ child_process
  process.chdir(tempRoot);
  // ★ รอบ 2 (R8): ไฟล์ชั่วคราวชื่อ production (meta_<เวลา>.mp4 · gv_<เวลา>.mp4 · fit_*) ต้องลงโฟลเดอร์ของข้อสอบนี้
  //   ไม่ใช่ temp กลางของเครื่อง (รันขนาน/รันคู่กับ worker จริงแล้วชื่อชนกันได้) — os.tmpdir() อ่าน env ทุกครั้งที่เรียก
  process.env.TMPDIR = process.env.TEMP = process.env.TMP = tempRoot;
});
const ENV_KEYS = ['CLIP_BRAIN_PIPELINE', 'CLIP_BRAIN_MIN_SEC', 'CLIP_ARCHIVE_CLOUD', 'GEMINI_VIDEO_API_KEY', 'NODE_ENV',
  'CLIP_GEMINI_FILE_WAIT_MS', 'CLIP_GEMINI_FILE_POLL_MS', 'CLIP_WORKER_BASE', 'CLIP_WORKER_SECRET', 'CLIP_WORKER_HEARTBEAT_MS',
  'TMPDIR', 'TEMP', 'TMP', 'CLIP_YTDLP_TIMEOUT_MS', 'CLIP_AGENT_API_KEY'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
const originalFetch = globalThis.fetch;
const setPlatform = (value) => Object.defineProperty(process, 'platform', { ...platformDescriptor, value });

after(() => {
  // ★ รอบ 2: ปิดทางคำขอที่ค้างเบื้องหลัง (ข้อสอบแดงเพราะหมดเวลา แต่คำขอยังโพลอยู่) — ตัวควบคุม stub หายแล้ว = คำขอนั้นล้มแทนสำเร็จ
  //   route เขียนสำเนา NDJSON ลง process.cwd()/data หลังถอดสำเร็จ — ถ้ามาสำเร็จหลังคืน cwd จะไปเขียนใน data/ ของ repo จริง
  //   (เจอจริงตอนทดสอบกลายพันธุ์ R4-b: คำขอที่ค้างเห็นสถานะ ACTIVE ของข้อสอบถัดไปแล้วเขียน data/clip-insights-archive.ndjson)
  globalThis.__co30 = undefined;
  globalThis.__co30Stores = undefined;
  process.chdir(originalCwd);
  Object.defineProperty(process, 'platform', platformDescriptor);
  globalThis.fetch = originalFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  if (!tempRoot) return;
  const inside = relative(resolvePath(SYSTEM_TMP), resolvePath(tempRoot));
  assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside), 'ลบได้เฉพาะโฟลเดอร์ลูกของ temp');
  rmSync(tempRoot, { recursive: true, force: true });
});

// ── โมดูลแทนของหนัก (ตัวควบคุมอยู่ที่ globalThis.__co30 ซึ่งแต่ละข้อสอบตั้งใหม่) ─────────
const STUBS = {
  'insight-service': `
    const S = () => globalThis.__co30;
    export async function extractClipInsight(args) {
      S().legacy.push({ kind: 'url', args });
      if (S().legacyFail) throw S().legacyFail();
      return { ...S().legacyResult };
    }
    export async function extractInsightFromVideoBuffer(buf, mimeType, model) {
      S().legacy.push({ kind: 'file', buf, mimeType, model });
      if (S().legacyImpl) return S().legacyImpl(buf, mimeType, model); // รอบ 2: ให้เดินเข้า callGeminiVideoFile ตัวจริงได้
      if (S().legacyFail) throw S().legacyFail();
      return { ...S().legacyResult };
    }
    export async function classifyTranscript() { return null; }
  `,
  brain: `
    export async function runClipBrainPipeline(args) {
      const s = globalThis.__co30;
      s.brain.push(args);
      return typeof s.brainResult === 'function' ? s.brainResult(args) : s.brainResult;
    }
  `,
  persist: `
    const stores = () => (globalThis.__co30Stores ||= new Map());
    export function createStore(name) {
      const rows = () => { if (!stores().has(name)) stores().set(name, []); return stores().get(name); };
      return {
        async getAll() { return rows().map((r) => structuredClone(r)); },
        async add(item) { rows().push(structuredClone(item)); return item; },
        async remove(id) { const a = rows(); const i = a.findIndex((r) => r.id === id); if (i >= 0) a.splice(i, 1); return i >= 0; },
        async findById(id) { const r = rows().find((x) => x.id === id); return r ? structuredClone(r) : null; },
        async removeAll() { stores().set(name, []); },
      };
    }
  `,
  queue: 'export function getClipVideoQueue() { return { run: (fn) => fn() }; }',
  archive: `
    export const CLIP_CASE_KEEP = 400;
    export const CLIP_ARCHIVE_STORE = 'clip-insights-archive';
    export function pickCasesToPurge() { return []; }
    export function archiveRowId(id) { return 'archive-' + id; }
  `,
  supabase: 'export function isSupabaseReady() { return false; } export function getSupabase() { return null; }',
  'topic-hunt': "export async function runTopicHunt() { throw new Error('runTopicHunt ต้องไม่ถูกเรียกในข้อสอบนี้'); }",
  'clip-openai': "export async function callAI() { throw new Error('callAI ต้องไม่ถูกเรียกในข้อสอบนี้'); }",
  'model-config': "export const MODEL_FAST = 'stub-fast';",
  // ถอดเสียง YouTube (ของจริงเป็นไฟล์ล็อกระบบข่าว — แทนด้วยตัวเก็บลิงก์ที่ได้รับ ไม่แตะไฟล์จริง)
  'youtube-service': `
    export async function transcribeYoutube({ url }) {
      globalThis.__co30.transcribed.push(url);
      return { success: true, rawText: 'บทถอดเสียงยูทูบทดสอบที่ยาวพอผ่านเกณฑ์สี่สิบตัวอักษรขึ้นไปแน่นอนครับผม', title: 'ยูทูบทดสอบ' };
    }
  `,
  'tiktok-service': `
    export async function transcribeTiktok({ url }) {
      globalThis.__co30.transcribed.push(url);
      return { success: true, rawText: 'บทถอดเสียงทดสอบที่ยาวพอผ่านเกณฑ์สี่สิบตัวอักษรขึ้นไปแน่นอนครับผม', title: 'แคปชั่นทดสอบ' };
    }
  `,
  genai: `
    export class GoogleGenerativeAI {
      constructor() {}
      getGenerativeModel({ model }) {
        return {
          generateContent: async () => {
            const g = globalThis.__co30.gen;
            g.calls.push(model);
            if (g.fail) throw g.fail();
            return { response: {
              text: () => '{"clipType":"interview","headline":"หัวข่าวไฟล์","rawData":"เนื้อจากไฟล์"}',
              usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 30 },
            } };
          },
        };
      }
    }
  `,
  'genai-server': `
    export const FileState = { STATE_UNSPECIFIED: 'STATE_UNSPECIFIED', PROCESSING: 'PROCESSING', ACTIVE: 'ACTIVE', FAILED: 'FAILED' };
    export class GoogleAIFileManager {
      constructor() {}
      async uploadFile(path, opts) {
        const f = globalThis.__co30.files;
        f.uploads.push({ path, opts });
        if (f.uploadFail) throw f.uploadFail();
        return { file: { name: 'files/co30' } };
      }
      async getFile(name) {
        const f = globalThis.__co30.files;
        f.polls += 1;
        const state = f.states.length > 1 ? f.states.shift() : f.states[0];
        return { name, state, uri: 'https://generativelanguage.test/v1beta/files/co30', mimeType: 'video/mp4' };
      }
      async deleteFile(name) { globalThis.__co30.files.deleted.push(name); }
    }
  `,
  // execFile ปลอม (yt-dlp/ffmpeg) — สมาชิกอื่นของ child_process เป็นของจริงทั้งหมด
  'child-process': `
    import real from 'node:child_process';
    import { promisify } from 'node:util';
    export * from 'node:child_process';
    export function execFile(cmd, args, opts, cb) {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      let result; let error = null;
      try { result = globalThis.__co30.exec(String(cmd), Array.isArray(args) ? args.map(String) : [], opts || {}); }
      catch (e) { error = e; }
      setImmediate(() => (error
        ? cb(error, error.stdout || '', error.stderr || '')
        : cb(null, (result && result.stdout) || '', '')));
      return {};
    }
    // เหมือน node จริง: promisify(execFile) ติด stdout/stderr ไว้บน error ก่อน reject
    execFile[promisify.custom] = (cmd, args, opts) => new Promise((resolve, reject) => {
      execFile(cmd, args, opts, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));
    });
    export default { ...real, execFile };
  `,
  'usage-logger': 'export function logApiUsage() {}',
  'safety-filter': 'export function sanitizeOutput(value) { return value; }',
  // ★ รอบ 4 (F1): fs/promises ของ route ถอดคลิป "ไฟล์เดียว" (insight/route.js) — ทุกอย่างเป็นของจริง ยกเว้น rm ที่ข้อสอบคุมได้
  //   ไม่ตั้งตัวคุม (rmCtl) = ส่งต่อ rm ตัวจริงทั้งก้อน (ข้อสอบอื่นพฤติกรรมเดิม)
  //   ตั้งตัวคุม = จำลอง "ไฟล์ยังถูกโปรเซสอื่นถือ" (Windows: Python ลูกของ yt-dlp ถือ .part ต่ออีก 2–3 วิหลังถูกฆ่า)
  //   โดยเลียนสัญญาของ Node ตามเอกสาร fsPromises.rm: เจอ EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM ลองซ้ำได้ maxRetries ครั้ง
  //   (มีผลเฉพาะ recursive:true · ไม่ตั้ง = 0 = ไม่ลองซ้ำ) · เวลารอย่อเหลือ 1ms/รอบ (ค่า retryDelay ตรวจแยกในข้อสอบ)
  //   รอบที่ปลดล็อกแล้วส่งให้ rm ตัวจริง "พร้อม options เดิมทั้งก้อน" — Node ตรวจชนิดค่าเอง (ค่าผิดชนิด = โยน = ข้อสอบแดง)
  'fs-promises': `
    import * as real from 'node:fs/promises';
    export * from 'node:fs/promises';
    const RETRYABLE = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);
    export async function rm(path, options) {
      const ctl = globalThis.__co30 && globalThis.__co30.rmCtl;
      if (!ctl) return real.rm(path, options);
      ctl.calls.push({ path: String(path), options: options && typeof options === 'object' ? { ...options } : options });
      const retries = options && options.recursive === true ? Math.max(0, Math.trunc(Number(options.maxRetries) || 0)) : 0;
      for (let attempt = 0; ; attempt += 1) {
        ctl.attempts += 1;
        if (ctl.lockedAttempts > 0) {
          ctl.lockedAttempts -= 1;
          const err = Object.assign(new Error(ctl.code + ': resource busy or locked, rmdir ' + String(path)), { code: ctl.code, syscall: 'rmdir', path: String(path) });
          if (!RETRYABLE.has(ctl.code) || attempt >= retries) throw err;
          await new Promise((done) => setTimeout(done, 1));
          continue;
        }
        return real.rm(path, options);
      }
    }
    export default { ...real, rm };
  `,
};
const STUB_BY_SPECIFIER = {
  '@/lib/services/clipInsightService': 'insight-service',
  '@/lib/services/clipBrain/clipBrainPipeline': 'brain',
  '@/lib/persistStore': 'persist',
  '@/lib/services/clipQueue': 'queue',
  '@/lib/services/clipArchive': 'archive',
  '@/lib/supabase': 'supabase',
  '@/lib/services/clipAI/topicHuntService': 'topic-hunt',
  '@/lib/services/clipAI/openai': 'clip-openai',
  '@/lib/ai/modelConfig': 'model-config',
  '@/lib/services/tiktokService': 'tiktok-service',
  '@/lib/services/youtubeService': 'youtube-service',
  '@google/generative-ai': 'genai',
  '@google/generative-ai/server': 'genai-server',
  child_process: 'child-process',
};
// import สัมพัทธ์ของ clipAI/geminiClient.js (ตัวบันทึกค่าใช้จ่าย/ตัวกรองคำ) — แทนเฉพาะเมื่อผู้ import คือไฟล์นั้น
const GEMINI_RELATIVE_STUBS = { '../../ai/usageLogger': 'usage-logger', './safetyFilter': 'safety-filter' };
// ★ รอบ 4 (F1): fs/promises ที่ route ถอดคลิปโหลด (dynamic import ใน downloadMetaBuffer/_fitForInline/สำเนา NDJSON) — แทนเฉพาะเมื่อผู้ import คือ insight/route.js
const INSIGHT_ROUTE_STUBS = { 'fs/promises': 'fs-promises' };
const STUB_URLS = Object.fromEntries(Object.entries(STUBS)
  .map(([key, source]) => [key, `data:text/javascript,${encodeURIComponent(source)}`]));

const LOADER = `
const SRC = ${JSON.stringify(new URL('../src/', import.meta.url).href)};
const NEXT_SERVER = ${JSON.stringify(new URL('../node_modules/next/server.js', import.meta.url).href)};
const STUB_URLS = ${JSON.stringify(STUB_URLS)};
const BY_SPEC = ${JSON.stringify(STUB_BY_SPECIFIER)};
const GEMINI_REL = ${JSON.stringify(GEMINI_RELATIVE_STUBS)};
const INSIGHT_ONLY = ${JSON.stringify(INSIGHT_ROUTE_STUBS)};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const hasExt = (s) => /[.][a-z]+$/i.test(s);
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') return nextResolve(NEXT_SERVER, context);
  if (has(BY_SPEC, specifier)) return { url: STUB_URLS[BY_SPEC[specifier]], shortCircuit: true };
  if (String(context.parentURL || '').includes('/clipAI/geminiClient.js') && has(GEMINI_REL, specifier)) {
    return { url: STUB_URLS[GEMINI_REL[specifier]], shortCircuit: true };
  }
  if (String(context.parentURL || '').includes('/clip-transcript/insight/route.js') && has(INSIGHT_ONLY, specifier)) {
    return { url: STUB_URLS[INSIGHT_ONLY[specifier]], shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const path = specifier.slice(2);
    return nextResolve(new URL(hasExt(path) ? path : path + '.js', SRC).href, context);
  }
  try { return await nextResolve(specifier, context); }
  catch (error) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !hasExt(specifier)) return nextResolve(specifier + '.js', context);
    throw error;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(LOADER)}`, import.meta.url);

const insightRoute = await import(new URL('../src/app/api/clip-transcript/insight/route.js', import.meta.url).href);
const transcriptRoute = await import(new URL('../src/app/api/clip-transcript/route.js', import.meta.url).href);
const huntRoute = await import(new URL('../src/app/api/clip-transcript/hunt/route.js', import.meta.url).href);
const { submitClipJob } = await import(new URL('../src/lib/services/clipJobs.js', import.meta.url).href);
const { extractFirstUrl, cleanClipUrl } = await import(new URL('../src/lib/services/clipAgent/clipUrl.js', import.meta.url).href);
const gemini = await import(new URL('../src/lib/services/clipAI/geminiClient.js', import.meta.url).href);
const resultRoute = await import(new URL('../src/app/api/clip-agent/result/route.js', import.meta.url).href); // ★ รอบ 4 (F6): ค้นผลด้วยลิงก์เดิม

// ── สถานะควบคุมของแต่ละข้อสอบ ─────────────────────────────────────────────
const brainOk = () => ({ ok: true, insight: { headline: 'หัวข่าวจากเครื่องยนต์ใหม่', rawData: 'ก'.repeat(400) }, spentTokens: 5000 });
// ผลล้มทรงเดียวกับ clipBrainPipeline.fail(): spentTokens = รอบที่ "รับผล" · brain.usage.totalTokens = บิลจริงรวมทุก attempt
const brainFail = (spentTokens, errorType = 'PIPE_MAP_FAILED', billedTokens = spentTokens) => ({
  ok: false, errorType, error: 'แผนที่ประเด็นล้ม', spentTokens,
  brain: { usage: { inputTokens: billedTokens, outputTokens: 0, cachedTokens: 0, totalTokens: billedTokens } },
});

// yt-dlp ปลอม: เขียนไฟล์ขนาดที่กำหนดลงพาธ -o จริง (route อ่านไฟล์เองตามปกติ) · ffmpeg = ไม่มีในเครื่อง (บีบไม่ได้ ใช้ไฟล์เดิม)
//   ★ รอบ 3 (M2): เก็บ options ของ execFile (เพดานเวลา) · ทิ้ง "ไฟล์ระหว่างทาง" ข้างไฟล์ปลายทางแบบ yt-dlp จริง
//   (video.mp4.part · DASH video.f<รหัส>.* · .ytdl) ก่อนล้ม/สำเร็จ — ถูกฆ่ากลางทางไฟล์พวกนี้ค้างจริง
function fakeExec(cmd, args, opts = {}) {
  const s = globalThis.__co30;
  s.execCalls.push({ cmd, args, opts });
  if (/yt-dlp/i.test(cmd)) {
    if (args.includes('--get-duration')) return { stdout: '1:03:12\n' };
    s.downloads += 1;
    s.downloadedUrls.push(args[args.length - 1]);
    const out = args[args.indexOf('-o') + 1];
    for (const name of s.downloadLeftovers) writeFileSync(join(dirname(out), name), 'partial');
    if (s.downloadFail) throw s.downloadFail();
    writeFileSync(out, Buffer.alloc(s.downloadBytes, 1));
    return { stdout: '' };
  }
  if (/ffmpeg/i.test(cmd)) throw Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
  throw new Error(`ไม่คาดว่าจะรันคำสั่ง ${cmd}`);
}

function freshState(overrides = {}) {
  globalThis.__co30 = {
    brain: [], brainResult: brainOk(),
    legacy: [], legacyResult: { headline: 'หัวข่าวจากเครื่องยนต์เดิม', rawData: 'ข'.repeat(400) }, legacyFail: null, legacyImpl: null,
    exec: fakeExec, execCalls: [], downloads: 0, downloadedUrls: [], downloadBytes: MB, downloadFail: null, downloadLeftovers: [],
    gen: { calls: [], fail: null },
    files: { uploads: [], polls: 0, states: ['ACTIVE'], deleted: [], uploadFail: null },
    transcribed: [],
    rmCtl: null, // ★ รอบ 4 (F1): ตัวคุม rm ปลอมของ route ถอด (null = rm ตัวจริงทั้งก้อน)
    ...overrides,
  };
  globalThis.__co30Stores = new Map();
  return globalThis.__co30;
}

beforeEach(() => {
  freshState();
  setPlatform('win32'); // FB/IG โหลดด้วย yt-dlp ได้เฉพาะเครื่องทีม Windows — จำลองให้รันบน CI (ubuntu) ได้
  globalThis.fetch = async (u) => { throw new Error(`ข้อสอบนี้ห้ามออกเน็ต: ${u}`); };
  delete process.env.CLIP_BRAIN_PIPELINE;
  delete process.env.CLIP_BRAIN_MIN_SEC;
  process.env.CLIP_ARCHIVE_CLOUD = '0';
  process.env.GEMINI_VIDEO_API_KEY = 'co30-test-key';
  delete process.env.NODE_ENV;
  delete process.env.CLIP_GEMINI_FILE_WAIT_MS;
  delete process.env.CLIP_GEMINI_FILE_POLL_MS;
  delete process.env.CLIP_YTDLP_TIMEOUT_MS;
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor);
  globalThis.fetch = originalFetch;
});

async function post(route, path, body) {
  const res = await settleWithin(route.POST(new Request(`http://localhost${path}`, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body),
  })), `POST ${path} ต้องตอบกลับ`, 10_000);
  return { status: res.status, body: await res.json() };
}
const postInsight = (body) => post(insightRoute, '/api/clip-transcript/insight', body);

const OVER_INLINE = Buffer.alloc(19 * MB + 1, 5); // ใหญ่กว่าเพดานแนบตรง 19MB → callGeminiVideoFile เดินเส้น Files API
const callFileApi = (extra = {}) => gemini.callGeminiVideoFile({
  prompt: 'ถอดคลิปทดสอบ', videoBuffer: OVER_INLINE, maxAttempts: 1, allowModelFallback: false, ...extra,
});
const rejectionOf = (promise) => promise.then(() => null, (error) => error);
// ★ รอบ 2 (R4): เวลารอสั้นในข้อสอบส่งผ่าน _fileWait ของ callGeminiVideoFile เท่านั้น (env ถูกกรอบเด็ดขาดเสมอ ไม่มีประตูหลัง NODE_ENV=test)
const fileWait = (waitMs, pollMs) => ({ _fileWait: { waitMs, pollMs } });
function fileWaitEnv(waitMs, pollMs) {
  process.env.CLIP_GEMINI_FILE_WAIT_MS = String(waitMs);
  process.env.CLIP_GEMINI_FILE_POLL_MS = String(pollMs);
}

// worker ตัวจริง (scripts/clip-worker.mjs) โหลดแบบเดียวกับ tests/clip-worker-lease.test.mjs — ตัดเฉพาะลูป/undici/scheduler
function replaceOnce(source, before, afterText, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label}: ไม่พบข้อความต้นทาง`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${label}: ต้องมีจุดเดียว`);
  return source.slice(0, first) + afterText + source.slice(first + before.length);
}
async function loadWorker() {
  let src = readFileSync(new URL('../scripts/clip-worker.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('let longDispatcher = null;');
  const end = src.indexOf('const log =', start);
  assert.ok(start >= 0 && end > start, 'หา undici bootstrap ของ worker ไม่พบ');
  src = `${src.slice(0, start)}let longDispatcher = null;\n\n${src.slice(end)}`;
  src = replaceOnce(src, "import { runWorkerLoop, clampConcurrency } from './lib/clip-worker-scheduler.mjs';",
    'const runWorkerLoop = async () => {}; const clampConcurrency = () => 1;', 'ตัด import scheduler');
  src = replaceOnce(src, "loop().catch((e) => { console.error('clip-worker crashed:', e); process.exit(1); });", '', 'ตัดลูปจริง');
  src += `\nexport { runJob };\n// ${Date.now()}-${Math.random()}\n`;
  process.env.CLIP_WORKER_BASE = 'http://clip-worker.test';
  process.env.CLIP_WORKER_SECRET = 'co30-worker-secret';
  process.env.CLIP_WORKER_HEARTBEAT_MS = '600000';
  return import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
}
// ให้ worker ถอดหนึ่งงานโดย "เซิร์ฟเวอร์" ตอบผล endpoint ประมวลผล (/insight หรือ /hunt ตาม kind) ตามที่กำหนด
//   — เก็บสถานะ+ข้อความที่รายงานกลับคิว + endpoint ที่ worker ยิงจริง + log ที่พิมพ์
async function runJobAgainst(worker, processStatus, processBody, { kind = 'insight' } = {}) {
  const reports = [];
  const logs = [];
  const processUrls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'http://clip-worker.test/api/clip-transcript/worker') {
      reports.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: JSON_HEADERS });
    }
    if (u.startsWith('http://clip-worker.test/api/clip-transcript')) {
      processUrls.push(u);
      return new Response(JSON.stringify(processBody), { status: processStatus, headers: JSON_HEADERS });
    }
    throw new Error(`fetch ที่ไม่คาดไว้: ${u}`);
  };
  const originalLog = console.log;
  console.log = (...parts) => { logs.push(parts.map(String).join(' ')); };
  try {
    await settleWithin(worker.runJob({
      id: 'co30-job-0001', url: FB_ONE, kind, platform: 'meta', claimToken: 'owner-token',
      leaseExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    }), 'runJob ต้องจบ', 5_000);
  } finally {
    console.log = originalLog;
  }
  return {
    statuses: reports.map((r) => r.status),
    errors: reports.map((r) => r.error),
    processUrls,
    finalLog: logs.find((l) => /❌|⏳|✅/.test(l)) || '',
  };
}

// ═══ ข้อ 1: เครื่องยนต์ใหม่ต้องได้ไฟล์คลิป (เดิม FB/IG/TikTok ตกเครื่องยนต์เดิม 528/528 ใบ) ═══════════
test('ข้อ 1: ลิงก์ FB บนเครื่องทีม → เครื่องยนต์ใหม่ได้ videoBuffer ตัวที่โหลดมา (1MB) และโหลดคลิปครั้งเดียว', async () => {
  const s = globalThis.__co30;
  const { status, body } = await postInsight({ url: FB_ONE });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.headline, 'หัวข่าวจากเครื่องยนต์ใหม่');
  assert.equal(s.downloads, 1, 'yt-dlp ต้องถูกเรียกโหลดครั้งเดียว');
  const ytArgs = s.execCalls.find((c) => /yt-dlp/i.test(c.cmd)).args;
  const outPath = resolvePath(ytArgs[ytArgs.indexOf('-o') + 1]);
  assert.ok(outPath.startsWith(resolvePath(tempRoot)) && outPath !== resolvePath(tempRoot), `R8: ไฟล์ชั่วคราวของ yt-dlp ต้องอยู่ในโฟลเดอร์ข้อสอบ (ได้ ${outPath})`);
  assert.equal(s.brain.length, 1);
  assert.ok(Buffer.isBuffer(s.brain[0].videoBuffer), 'เครื่องยนต์ใหม่ต้องได้ไฟล์ ไม่ใช่ undefined (ต้นเหตุ BAD_INPUT 0 token)');
  assert.equal(s.brain[0].videoBuffer.length, MB);
  assert.equal(s.brain[0].isYouTube, false);
  assert.equal(s.brain[0].url, FB_ONE);
  assert.equal(s.legacy.length, 0, 'เครื่องยนต์ใหม่สำเร็จ = ไม่ต้องเรียกเครื่องยนต์เดิม');
  assert.equal(body.data.brainFallback, undefined);
});

test('ข้อ 1: เครื่องยนต์ใหม่ล้ม → เครื่องยนต์เดิมได้บัฟเฟอร์ "ตัวเดียวกัน" ไม่โหลดซ้ำ และติดธง brainFallback', async () => {
  const s = freshState({ brainResult: brainFail(0) });
  const { status, body } = await postInsight({ url: FB_ONE });
  assert.equal(status, 200);
  assert.equal(body.data.headline, 'หัวข่าวจากเครื่องยนต์เดิม');
  assert.equal(body.data.brainFallback, true);
  assert.equal(s.downloads, 1, 'ห้ามโหลดคลิปซ้ำตอนถอยไปเครื่องยนต์เดิม');
  assert.equal(s.brain.length, 1);
  assert.equal(s.legacy.length, 1);
  assert.equal(s.legacy[0].kind, 'file');
  assert.equal(s.legacy[0].buf, s.brain[0].videoBuffer, 'ต้องเป็นบัฟเฟอร์ตัวเดียวกัน (อ้างอิงเดียวกัน)');
  assert.equal(s.legacy[0].buf.length, MB);
});

test('ข้อ 1: ไฟล์ >19MB (บีบไม่ลง) → ข้ามเครื่องยนต์ใหม่ทั้งหมด ไปเครื่องยนต์เดิม (Files API) พร้อมธง brainFallback', async () => {
  const s = freshState({ downloadBytes: 20 * MB });
  const { status, body } = await postInsight({ url: FB_ONE });
  assert.equal(status, 200);
  assert.equal(s.brain.length, 0, 'เครื่องยนต์ใหม่รับแนบตรง ≤19MB เท่านั้น — ห้ามเรียกเลย');
  assert.equal(s.downloads, 1);
  assert.ok(s.execCalls.some((c) => /ffmpeg/i.test(c.cmd)), 'ต้องลองบีบก่อน (บีบไม่ได้ = ใช้ไฟล์เดิม)');
  assert.equal(s.legacy.length, 1);
  assert.equal(s.legacy[0].buf.length, 20 * MB);
  assert.equal(body.data.brainFallback, true);
});

test('ข้อ 1: YouTube คงเดิม — เครื่องยนต์ใหม่ได้ลิงก์ (isYouTube:true) ไม่มีบัฟเฟอร์ และไม่โหลดไฟล์ล่วงหน้า', async () => {
  const s = globalThis.__co30;
  const { status } = await postInsight({ url: 'https://youtu.be/dQw4w9WgXcQ?si=abc' });
  assert.equal(status, 200);
  assert.equal(s.brain.length, 1);
  assert.equal(s.brain[0].isYouTube, true);
  assert.equal(s.brain[0].videoBuffer, undefined);
  assert.equal(s.brain[0].url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(s.downloads, 0, 'YouTube ห้ามโหลดไฟล์ก่อนเครื่องยนต์ใหม่');
});

test('ข้อ 1: TikTok (tikwm) ก็ส่งไฟล์เข้าเครื่องยนต์ใหม่ · ปิดเครื่องยนต์ใหม่ = เครื่องยนต์เดิมได้ไฟล์เดิม ไม่ติดธง', async () => {
  const s = globalThis.__co30;
  const video = Buffer.alloc(2 * MB, 3);
  const fetched = [];
  globalThis.fetch = async (u) => {
    fetched.push(String(u));
    if (String(u).includes('tikwm.com')) return new Response(JSON.stringify({ data: { play: 'https://cdn.tiktok.test/v.mp4' } }));
    return new Response(video);
  };
  const { status } = await postInsight({ url: 'https://www.tiktok.com/@a/video/123' });
  assert.equal(status, 200);
  assert.equal(s.brain.length, 1);
  assert.equal(s.brain[0].videoBuffer.length, 2 * MB);
  assert.equal(fetched.length, 2, 'ถาม tikwm 1 + โหลดไฟล์ 1 เท่านั้น');

  const off = freshState();
  process.env.CLIP_BRAIN_PIPELINE = '0';
  const { status: offStatus, body } = await postInsight({ url: FB_ONE });
  assert.equal(offStatus, 200);
  assert.equal(off.brain.length, 0);
  assert.equal(off.downloads, 1);
  assert.equal(off.legacy[0].buf.length, MB);
  assert.equal(body.data.brainFallback, undefined, 'ปิดเครื่องยนต์ใหม่เอง = ไม่ใช่การถอย จึงไม่ติดธง');
});

// ═══ ข้อ 2: Files API รอประมวลผลตามเวลา (เดิมรอได้แค่ 60×2 วิ แล้วโยน state=PROCESSING) ═════════════
test('ข้อ 2: Files API — PROCESSING 3 รอบแล้ว ACTIVE → สำเร็จ ยิง generateContent ครั้งเดียว และลบไฟล์บน Gemini', async () => {
  const s = freshState();
  s.files.states = ['PROCESSING', 'PROCESSING', 'PROCESSING', 'ACTIVE'];
  const out = await settleWithin(callFileApi(fileWait(2000, 5)), 'ต้องสำเร็จเมื่อไฟล์ ACTIVE (ช่วงโพลจาก _fileWait)', 1_500);
  assert.equal(out.rawData, 'เนื้อจากไฟล์');
  assert.equal(s.files.uploads.length, 1);
  const uploadPath = resolvePath(s.files.uploads[0].path);
  assert.ok(uploadPath.startsWith(resolvePath(tempRoot)) && uploadPath !== resolvePath(tempRoot), `R8: ไฟล์ชั่วคราวที่อัปโหลดต้องอยู่ในโฟลเดอร์ข้อสอบ (ได้ ${uploadPath})`);
  assert.equal(s.files.polls, 4, 'เช็คสถานะจนเจอ ACTIVE');
  assert.equal(s.gen.calls.length, 1, 'generateContent ครั้งเดียว');
  assert.deepEqual(s.files.deleted, ['files/co30']);
});

test('ข้อ 2: PROCESSING ตลอด (_fileWait รอ 60ms โพล 5ms ชนะ env) → โยน timeout + retrySafe · ไม่ยิง generateContent · ลบไฟล์ทิ้ง', async () => {
  const s = freshState();
  s.files.states = ['PROCESSING'];
  fileWaitEnv(1_800_000, 30_000); // env เพดานสูงสุด — _fileWait ของข้อสอบต้องชนะ (ไม่งั้นรอ 30 นาที)
  const startedAt = Date.now();
  const err = await settleWithin(rejectionOf(callFileApi(fileWait(60, 5))), 'ต้องโยนเมื่อหมดเวลารอ', 1_500);
  assert.ok(err instanceof Error, 'ต้องล้ม');
  assert.match(err.message, /timeout/, 'ข้อความต้องมีคำว่า timeout (worker isTransient นับเป็นชั่วคราว)');
  assert.equal(err.retrySafe, true, 'ยังไม่ยิงโมเดล = retrySafe');
  assert.equal(s.gen.calls.length, 0, 'ห้ามยิง generateContent');
  assert.ok(s.files.polls >= 3, `ต้องเช็คซ้ำตามช่วงโพล (เช็ค ${s.files.polls} ครั้ง)`);
  assert.ok(Date.now() - startedAt >= 55, 'ต้องรอจริงราวเวลาที่กำหนด');
  assert.deepEqual(s.files.deleted, ['files/co30'], 'รอไม่ทันก็ต้องลบไฟล์บน Gemini');
});

test('ข้อ 2: สถานะ FAILED → โยนทันที ข้อความมี "กดใหม่ไม่ช่วย" + retrySafe (ไม่รอ ไม่ยิงโมเดล)', async () => {
  const s = freshState();
  s.files.states = ['FAILED'];
  const err = await settleWithin(rejectionOf(callFileApi(fileWait(5000, 1000))), 'FAILED ต้องโยนทันทีโดยไม่รอรอบโพล', 800);
  assert.ok(err instanceof Error);
  assert.match(err.message, /กดใหม่ไม่ช่วย/);
  assert.equal(err.retrySafe, true);
  assert.equal(s.files.polls, 1);
  assert.equal(s.gen.calls.length, 0);
});

test('ข้อ 2: อัปโหลดล้ม (ก่อนยิงโมเดล) → retrySafe · error จาก generateContent (ไฟล์และ inline) → ห้ามติด retrySafe', async () => {
  const s = freshState();
  s.files.uploadFail = () => new Error('upload failed: ECONNRESET');
  const uploadErr = await settleWithin(rejectionOf(callFileApi(fileWait(2000, 5))), 'อัปโหลดล้มต้องโยน', 1_500);
  assert.match(uploadErr.message, /upload failed/);
  assert.equal(uploadErr.retrySafe, true);
  assert.equal(s.gen.calls.length, 0);

  const g = freshState();
  g.gen.fail = () => Object.assign(new Error('500 internal provider error'), { status: 500 });
  const providerErr = await settleWithin(rejectionOf(callFileApi()), 'provider error ต้องโยน', 1_500);
  assert.match(providerErr.message, /internal provider error/);
  assert.notEqual(providerErr.retrySafe, true, 'หลังเริ่มยิงโมเดลอาจคิดเงินแล้ว — ห้ามติดธง');
  assert.equal(g.gen.calls.length, 1);

  const inline = freshState();
  inline.gen.fail = () => Object.assign(new Error('500 internal provider error'), { status: 500 });
  const inlineErr = await settleWithin(rejectionOf(callFileApi({ videoBuffer: Buffer.alloc(20_000, 2) })), 'inline ต้องโยน', 1_500);
  assert.notEqual(inlineErr.retrySafe, true);
  assert.equal(inline.files.uploads.length, 0, 'ไฟล์เล็กแนบตรง ไม่อัปโหลด');
});

test('ข้อ 2 (R4): กรอบค่า env ตามเครื่อง — win32 10 นาที (เพดาน 30 นาที) · คลาวด์ 4 นาที (เพดาน 5 นาที) · พื้น 30 วิ/200ms · ไม่มีประตูหลัง NODE_ENV=test', () => {
  const r = gemini.resolveGeminiFileWait;
  // เครื่องทีม (Windows · worker ไม่มีเพดานเวลาของแพลตฟอร์ม)
  setPlatform('win32');
  assert.deepEqual(r({}), { waitMs: 600_000, pollMs: 3_000 });
  assert.deepEqual(r({ CLIP_GEMINI_FILE_WAIT_MS: '60', CLIP_GEMINI_FILE_POLL_MS: '5' }), { waitMs: 30_000, pollMs: 200 });
  assert.deepEqual(r({ CLIP_GEMINI_FILE_WAIT_MS: '99999999', CLIP_GEMINI_FILE_POLL_MS: '99999999' }), { waitMs: 1_800_000, pollMs: 30_000 });
  assert.deepEqual(r({ CLIP_GEMINI_FILE_WAIT_MS: 'abc', CLIP_GEMINI_FILE_POLL_MS: '' }), { waitMs: 600_000, pollMs: 3_000 });
  assert.deepEqual(r({ CLIP_GEMINI_FILE_WAIT_MS: '0', CLIP_GEMINI_FILE_POLL_MS: '-5' }), { waitMs: 600_000, pollMs: 3_000 });
  assert.deepEqual(r({ CLIP_GEMINI_FILE_WAIT_MS: '900000', CLIP_GEMINI_FILE_POLL_MS: '5000' }), { waitMs: 900_000, pollMs: 5_000 });
  // คลาวด์ (Vercel maxDuration=800 — โหลด+อัปโหลด+รอ+inference 280 วิ ต้องอยู่ใต้ 800 วิ)
  setPlatform('linux');
  assert.deepEqual(r({}), { waitMs: 240_000, pollMs: 3_000 });
  assert.deepEqual(r({ CLIP_GEMINI_FILE_WAIT_MS: '900000', CLIP_GEMINI_FILE_POLL_MS: '5000' }), { waitMs: 300_000, pollMs: 5_000 }, 'เพดานคลาวด์ 5 นาที');
  assert.deepEqual(r({ CLIP_GEMINI_FILE_WAIT_MS: '120000' }), { waitMs: 120_000, pollMs: 3_000 }, 'env ทับได้ภายในกรอบ');
  assert.deepEqual(r({ CLIP_GEMINI_FILE_WAIT_MS: '60', CLIP_GEMINI_FILE_POLL_MS: '5' }), { waitMs: 30_000, pollMs: 200 });
  assert.deepEqual(r({ CLIP_GEMINI_FILE_WAIT_MS: 'abc' }), { waitMs: 240_000, pollMs: 3_000 });
  // ไม่มีประตูหลัง: NODE_ENV ใดๆ ก็ถูกกรอบเท่ากัน ทั้งสองเครื่อง
  for (const platform of ['win32', 'linux']) {
    setPlatform(platform);
    for (const NODE_ENV of ['test', 'production', 'development']) {
      assert.deepEqual(r({ NODE_ENV, CLIP_GEMINI_FILE_WAIT_MS: '60', CLIP_GEMINI_FILE_POLL_MS: '5' }), { waitMs: 30_000, pollMs: 200 },
        `${platform} NODE_ENV=${NODE_ENV} ต้องไม่ปลดพื้นขั้นต่ำ`);
    }
  }
  // ค่าเริ่มต้นอ่าน process.env จริงเมื่อไม่ส่งอาร์กิวเมนต์
  setPlatform('linux');
  fileWaitEnv(45_000, 1_000);
  assert.deepEqual(r(), { waitMs: 45_000, pollMs: 1_000 });
});

test('ข้อ 2 (R4): env 60ms/5ms ถูกยกเป็นพื้นเสมอแม้ NODE_ENV=test — PROCESSING 2 รอบแล้ว ACTIVE ต้องสำเร็จ ไม่ timeout ที่ 60ms', async () => {
  const s = freshState();
  s.files.states = ['PROCESSING', 'PROCESSING', 'ACTIVE'];
  process.env.NODE_ENV = 'test'; // เดิมเป็นประตูหลังปลดพื้น — ตอนนี้ต้องไม่มีผล
  fileWaitEnv(60, 5);
  const startedAt = Date.now();
  const out = await settleWithin(callFileApi(), 'ต้องรอเกิน 60ms ได้ (พื้น 30 วิ) และโพลตามพื้น 200ms', 3_000);
  assert.equal(out.rawData, 'เนื้อจากไฟล์');
  assert.ok(Date.now() - startedAt >= 390, 'ช่วงโพลต้องถูกยกเป็นพื้น 200ms (2 รอบ ≥ ~400ms)');
  assert.equal(s.gen.calls.length, 1);
});

// ═══ ข้อ 3: retrySafe ต้องไปถึง worker จริง (เดิมไม่มี route ไหนตั้ง → retry อัตโนมัติ 0 ครั้งตั้งแต่ 22 ส.ค.) ════
const preProviderFailure = () => Object.assign(
  new Error('Gemini ประมวลผลวิดีโอไม่ทันเวลา 600 วิ (state=PROCESSING, timeout)'), { retrySafe: true });

test('ข้อ 3: yt-dlp ล้ม (ยังไม่ยิง AI) → 422 พร้อม retrySafe:true และไม่แตะเครื่องยนต์ใดเลย', async () => {
  const s = freshState({ downloadFail: () => Object.assign(new Error('Command failed: yt-dlp.exe ERROR: Unable to download webpage'), { code: 1 }) });
  const { status, body } = await postInsight({ url: FB_ONE });
  assert.equal(status, 422);
  assert.equal(body.success, false);
  assert.equal(body.retrySafe, true);
  assert.ok(body.error && body.errorType !== undefined, 'ต้องคงรูป error JSON เดิม');
  assert.equal(s.brain.length, 0);
  assert.equal(s.legacy.length, 0);
});

test('ข้อ 3: tikwm ล้ม (เน็ต) → 422 พร้อม retrySafe:true', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const { status, body } = await postInsight({ url: 'https://www.tiktok.com/@a/video/123' });
  assert.equal(status, 422);
  assert.equal(body.retrySafe, true);
});

test('ข้อ 3: เครื่องยนต์ใหม่ล้มก่อนถึงผู้ให้บริการ (NO_KEY · 0 token) + เครื่องยนต์เดิมล้มก่อนยิงโมเดล → retrySafe:true', async () => {
  freshState({ brainResult: brainFail(0, 'NO_KEY'), legacyFail: preProviderFailure });
  const { status, body } = await postInsight({ url: FB_ONE });
  assert.equal(status, 422);
  assert.equal(body.retrySafe, true);
});

test('ข้อ 3: เครื่องยนต์ใหม่ใช้โทเคนไปแล้ว (1234) หรือพังผิดคาด แล้วเครื่องยนต์เดิมล้มก่อนยิงโมเดล → ไม่มี retrySafe (กันจ่ายซ้ำ)', async () => {
  freshState({ brainResult: brainFail(1234), legacyFail: preProviderFailure });
  const spent = await postInsight({ url: FB_ONE });
  assert.equal(spent.status, 422);
  assert.equal(Object.hasOwn(spent.body, 'retrySafe'), false, 'ใช้โทเคนไปแล้ว = ห้ามให้ worker ลองซ้ำอัตโนมัติ');

  freshState({ brainResult: () => { throw new Error('สมองพังกลางทาง'); }, legacyFail: preProviderFailure });
  const crashed = await postInsight({ url: FB_ONE });
  assert.equal(crashed.status, 422);
  assert.equal(Object.hasOwn(crashed.body, 'retrySafe'), false, 'ไม่รู้ยอดที่ใช้ไป = ถือว่าอาจจ่ายแล้ว');
});

// ═══ รอบ 2 · R2: ยอดที่ตัดสิน retrySafe ต้องเป็น "บิลจริง" (brain.usage.totalTokens) ไม่ใช่ spentTokens อย่างเดียว ═══
test('R2: บิลจริงของเครื่องยนต์ใหม่ (usage รวมทุก attempt) กัน retrySafe · ยอด 0 ยอมเฉพาะล้มก่อนถึงผู้ให้บริการ', async () => {
  const cases = [
    // [ผลของเครื่องยนต์ใหม่, ต้องมี retrySafe ไหม, เหตุผล]
    [brainFail(0, 'BAD_JSON', 5000), false, 'ถูกบิล 5000 token แต่ตอบ JSON เสีย — spentTokens 0 แต่จ่ายไปแล้ว'],
    [brainFail(0, 'MAX_TOKENS', 32000), false, 'ถูกบิลเต็มเพดานแล้วโดนตัด'],
    [brainFail(0, 'NETWORK', 0), false, 'เน็ตหลุดระหว่างรอคำตอบ — ไม่มี usage แต่อาจถูกบิลแล้ว'],
    [brainFail(0, 'PIPE_MAP_FAILED', 0), false, 'ล้มหลังยิงแล้วโดยไม่รู้ยอด'],
    [{ ok: false, errorType: 'TIMEOUT', error: 'หมดเวลา', spentTokens: 0 }, false, 'ไม่มีใบเสร็จ usage เลย'],
    [brainFail(0, 'BAD_INPUT', 0), true, 'ไฟล์เล็ก/ว่าง — ไม่ถึงผู้ให้บริการ'],
    [brainFail(0, 'TOO_LARGE', 0), true, 'ไฟล์ใหญ่เกินแนบตรง — ไม่ถึงผู้ให้บริการ'],
    [brainFail(0, 'NO_KEY', 0), true, 'ไม่มีคีย์ — ไม่ถึงผู้ให้บริการ'],
    [brainFail(0, 'PIPE_NO_SOURCE', 0), true, 'ไม่มีต้นทาง — ไม่ถึงผู้ให้บริการ'],
    [brainFail(0, 'BAD_INPUT', 300), false, 'ชนิดก่อนถึงผู้ให้บริการแต่มี usage จริง = บิลชนะ'],
  ];
  for (const [brainResult, wantRetrySafe, why] of cases) {
    const s = freshState({ brainResult, legacyFail: preProviderFailure });
    const { status, body } = await postInsight({ url: FB_ONE });
    assert.equal(status, 422, why);
    assert.equal(s.brain.length, 1, `${why}: ต้องลองเครื่องยนต์ใหม่ก่อน`);
    assert.equal(s.legacy.length, 1, `${why}: ต้องถอยไปเครื่องยนต์เดิม`);
    assert.equal(Object.hasOwn(body, 'retrySafe'), wantRetrySafe, `${brainResult.errorType}: ${why}`);
    if (wantRetrySafe) assert.equal(body.retrySafe, true);
  }
});

test('ข้อ 3: error จากผู้ให้บริการ (ไม่ติดธง) → ไม่มี retrySafe', async () => {
  freshState({ brainResult: brainFail(0), legacyFail: () => Object.assign(new Error('Gemini 503 high demand'), { status: 503 }) });
  const { status, body } = await postInsight({ url: FB_ONE });
  assert.equal(status, 422);
  assert.equal(Object.hasOwn(body, 'retrySafe'), false);
});

test('ข้อ 3 (worker): ล้มชั่วคราวที่ server ไม่ยืนยัน retrySafe → ไม่ลองซ้ำเอง แต่ log บอกให้กดส่งใหม่ได้ (ไม่ใช่ "กดใหม่ไม่ช่วย")', async () => {
  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const busy = await runJobAgainst(worker, 422, { success: false, error: 'ตอนนี้ Gemini มีคนใช้งานหนัก (แน่นชั่วคราว)', errorType: 'INSIGHT_FAILED' });
  assert.deepEqual(busy.statuses, ['error'], 'ไม่มี retrySafe = ห้าม retry อัตโนมัติ (ตรรกะเดิมกันจ่ายซ้ำ)');
  assert.match(busy.finalLog, /❌ ล้มหลังเริ่มยิง AI แล้ว — ไม่ลองซ้ำอัตโนมัติ \(กันจ่ายซ้ำ\) กดส่งใหม่เองได้/);
  assert.doesNotMatch(busy.finalLog, /กดใหม่ไม่ช่วย/);

  const permanent = await runJobAgainst(worker, 422, { success: false, error: 'Gemini เปิดดูคลิปนี้ไม่ได้ (อาจเป็นคลิปส่วนตัว)', errorType: 'INSIGHT_FAILED' });
  assert.deepEqual(permanent.statuses, ['error']);
  assert.match(permanent.finalLog, /❌ ถอดไม่ได้จริง \(กดใหม่ไม่ช่วย\)/, 'ล้มถาวรจริงยังคงข้อความเดิม');

  const safe = await runJobAgainst(worker, 422, { success: false, error: 'ตอนนี้ Gemini มีคนใช้งานหนัก (แน่นชั่วคราว)', errorType: 'INSIGHT_FAILED', retrySafe: true });
  assert.deepEqual(safe.statuses, ['retry'], 'server ยืนยัน retrySafe + ชั่วคราว = เข้าคิวลองใหม่');
  assert.match(safe.finalLog, /⏳ สะดุดชั่วคราว/);
});

test('ข้อ 3 (ปลายทาง): ผลจริงของ /insight ตอน tikwm เน็ตล่ม → worker ตัวจริงเข้าคิวลองใหม่ (retry) ได้แล้ว', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const insight = await postInsight({ url: 'https://www.tiktok.com/@a/video/123' });
  assert.equal(insight.body.retrySafe, true);
  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const run = await runJobAgainst(worker, insight.status, insight.body);
  assert.deepEqual(run.statuses, ['retry'], 'ล้มก่อนจ่ายเงิน + ชั่วคราว = ลองใหม่อัตโนมัติ');

  const provider = freshState({ brainResult: brainFail(0), legacyFail: () => new Error('Gemini 503 high demand') });
  const paid = await postInsight({ url: FB_ONE });
  assert.equal(provider.legacy.length, 1);
  const runPaid = await runJobAgainst(worker, paid.status, paid.body);
  assert.deepEqual(runPaid.statuses, ['error'], 'ล้มหลังยิงโมเดล = ห้ามลองซ้ำเอง');
});

// ═══ รอบ 2 · R5: ข้อความจาก Files API ผ่าน humanizeErr ต้องคงความหมาย (timeout = ชั่วคราว · FAILED = ถาวร) ═══
//   คลิป >19MB (บีบไม่ลง) → ข้ามเครื่องยนต์ใหม่ → เครื่องยนต์เดิมเดินเข้า callGeminiVideoFile "ตัวจริง" (error และธงมาจากฟังก์ชันจริง)
test('R5: Files API รอไม่ทัน (state=PROCESSING) → POST /insight → worker ตัวจริงลองใหม่ (retry) · ข้อความคงคำ timeout ไม่ใช่ข้อความเก่า ~4.5 นาที', async () => {
  const s = freshState({ downloadBytes: 20 * MB });
  s.files.states = ['PROCESSING'];
  s.legacyImpl = (buf) => gemini.callGeminiVideoFile({
    prompt: 'ถอดคลิปทดสอบ', videoBuffer: buf, maxAttempts: 1, allowModelFallback: false, _fileWait: { waitMs: 60, pollMs: 5 },
  });
  const insight = await postInsight({ url: FB_ONE });
  assert.equal(insight.status, 422);
  assert.equal(s.brain.length, 0, 'ไฟล์ >19MB ต้องข้ามเครื่องยนต์ใหม่');
  assert.equal(s.legacy.length, 1);
  assert.equal(s.files.uploads.length, 1, 'ต้องเดินเส้น Files API จริง');
  assert.equal(s.gen.calls.length, 0, 'รอไม่ทัน = ยังไม่ยิงโมเดล');
  assert.equal(insight.body.retrySafe, true, 'ล้มก่อนยิงโมเดล + เครื่องยนต์ใหม่ไม่ได้ใช้โทเคน');
  assert.match(insight.body.error, /timeout/, 'ต้องคงคำ timeout ให้ worker จับตรงๆ');
  // ★ รอบ 3 (L4): ถ้อยคำเป็นกลาง — ไม่สัญญา "ลองใหม่อัตโนมัติ" ทุกกรณี (ถอดตรง/เครื่องยนต์ใหม่จ่ายแล้ว ระบบจะไม่ลองเอง)
  assert.match(insight.body.error, /ถ้าส่งผ่านคิวเครื่องทีม ระบบจะลองใหม่ให้เอง · ถ้าถอดตรงให้กดส่งเข้าคิว/);
  assert.doesNotMatch(insight.body.error, /ลองใหม่อัตโนมัติ/, 'L4: ห้ามสัญญาว่าระบบจะลองใหม่อัตโนมัติทุกกรณี');
  assert.doesNotMatch(insight.body.error, /4\.5 นาที|ถอดประเด็นข่าว/, 'ห้ามเป็นข้อความเก่าของ timeout ทั่วไป');
  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const run = await runJobAgainst(worker, insight.status, insight.body);
  assert.deepEqual(run.statuses, ['retry']);
  assert.match(run.finalLog, /⏳ สะดุดชั่วคราว/);
});

test('R5: ไฟล์บน Gemini FAILED → POST /insight → worker ตัวจริงหยุด (error) · ข้อความบอก "กดใหม่ไม่ช่วย" แบบคนอ่าน ไม่ใช่ state ดิบ', async () => {
  const s = freshState({ downloadBytes: 20 * MB });
  s.files.states = ['FAILED'];
  s.legacyImpl = (buf) => gemini.callGeminiVideoFile({
    prompt: 'ถอดคลิปทดสอบ', videoBuffer: buf, maxAttempts: 1, allowModelFallback: false, _fileWait: { waitMs: 5_000, pollMs: 5 },
  });
  const insight = await postInsight({ url: FB_ONE });
  assert.equal(insight.status, 422);
  assert.equal(s.gen.calls.length, 0);
  assert.equal(insight.body.retrySafe, true, 'ยังไม่จ่ายค่าโมเดล (แต่ข้อความตัดสินว่าไม่ควรลองซ้ำ)');
  assert.match(insight.body.error, /กดใหม่ไม่ช่วย/);
  assert.doesNotMatch(insight.body.error, /state=|timeout/, 'ต้องแปลงเป็นข้อความคนอ่าน');
  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const run = await runJobAgainst(worker, insight.status, insight.body);
  assert.deepEqual(run.statuses, ['error']);
  assert.match(run.finalLog, /❌ ถอดไม่ได้จริง \(กดใหม่ไม่ช่วย\)/);
});

// ═══ รอบ 2 · R3: ข้อความจากตัวโหลดต้องบอก "ถาวร/ชั่วคราว" ถูกต้องที่ต้นทาง (isTransient ของ worker ถูกล็อก) ═══
// error ของ execFile ทรงเดียวกับ node จริง: "Command failed: <บรรทัดคำสั่ง>\n<stderr>" + code/killed/signal/stderr
//   พาธไฟล์ชั่วคราวใช้เวลาจริงช่วง 30 ก.ย. 69 (1790755034291) ที่มีเลข 503 และ 429 ปนโดยบังเอิญ — แบบเคสที่ผู้ตรวจพิสูจน์
function ytDlpError({ stderr = '', code = 1, killed = false, signal = null } = {}) {
  const cmdLine = 'C:\\tmp\\clip-brain-lab\\bin\\yt-dlp.exe -f mp4/best[ext=mp4]/best --merge-output-format mp4 '
    + '-o C:\\Users\\User\\AppData\\Local\\Temp\\meta_1790755034291.mp4 --no-warnings --no-playlist ' + FB_ONE;
  return Object.assign(new Error(`Command failed: ${cmdLine}\n${stderr}`), { code, killed, signal, stdout: '', stderr });
}
function tikwmFetch({ api, video }) {
  return async (u) => {
    if (String(u).includes('tikwm.com')) {
      if (api instanceof Error) throw api;
      return new Response(JSON.stringify(api));
    }
    return video();
  };
}
const TIKTOK_URL = 'https://www.tiktok.com/@a/video/123';

test('R3: ตัวโหลดล้ม → POST /insight จริง → worker ตัวจริง — ถาวรไม่วนซ้ำ · ชั่วคราวลองใหม่ · ข้อความไม่มีบรรทัดคำสั่ง/พาธชั่วคราว', async () => {
  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const cases = [
    { name: 'tikwm ตอบแต่ไม่มีลิงก์วิดีโอ (โพสต์รูป)', want: 'error', url: TIKTOK_URL,
      fetch: tikwmFetch({ api: { code: 0, msg: 'success', data: { images: ['https://cdn.tiktok.test/1.jpg'] } } }) },
    { name: 'tikwm ตอบลิงก์เสีย (Url parsing is failed)', want: 'error', url: TIKTOK_URL,
      fetch: tikwmFetch({ api: { code: -1, msg: 'Url parsing is failed! Please check url.' } }) },
    { name: 'tikwm วิดีโอใหญ่เกิน 150MB', want: 'error', url: TIKTOK_URL,
      fetch: tikwmFetch({ api: { data: { play: 'https://cdn.tiktok.test/v.mp4' } }, video: async () => ({ arrayBuffer: async () => new ArrayBuffer(150 * 1e6 + 1) }) }) },
    { name: 'tikwm เน็ตล่ม (fetch failed)', want: 'retry', url: TIKTOK_URL,
      fetch: tikwmFetch({ api: new TypeError('fetch failed') }) },
    { name: 'yt-dlp exit 1 "Unsupported URL"', want: 'error', url: FB_ONE,
      downloadFail: () => ytDlpError({ stderr: `ERROR: Unsupported URL: ${FB_ONE}\n` }) },
    { name: 'yt-dlp ถาวร (ต้องล็อกอิน) ทั้งที่พาธชั่วคราวมีเลข 503/429', want: 'error', url: FB_ONE,
      downloadFail: () => ytDlpError({ stderr: 'ERROR: [facebook] 1084395141170409: This video is only available for registered users. Use --cookies for the authentication.\n' }) },
    { name: 'yt-dlp "HTTP Error 429" (เฟซบุ๊กจำกัดความถี่)', want: 'retry', url: FB_ONE,
      downloadFail: () => ytDlpError({ stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: HTTP Error 429: Too Many Requests (caused by <HTTPError 429: Too Many Requests>)\n' }) },
    { name: 'yt-dlp ถูก kill เพราะหมดเวลา 180 วิ', want: 'retry', url: FB_ONE,
      downloadFail: () => ytDlpError({ code: null, killed: true, signal: 'SIGTERM', stderr: '' }) },
  ];
  for (const c of cases) {
    const s = freshState(c.downloadFail ? { downloadFail: c.downloadFail } : {});
    globalThis.fetch = c.fetch || (async (u) => { throw new Error(`ข้อสอบนี้ห้ามออกเน็ต: ${u}`); });
    const insight = await postInsight({ url: c.url });
    assert.equal(insight.status, 422, c.name);
    assert.equal(insight.body.retrySafe, true, `${c.name}: ล้มตอนโหลด = ยังไม่จ่ายค่าโมเดล`);
    assert.equal(s.brain.length + s.legacy.length, 0, `${c.name}: ห้ามแตะเครื่องยนต์ใด`);
    const run = await runJobAgainst(worker, insight.status, insight.body);
    assert.deepEqual(run.statuses, [c.want], `${c.name}: worker ต้องรายงาน ${c.want} (ได้ ${run.statuses}) · ข้อความ: ${insight.body.error}`);
    for (const text of [insight.body.error, run.errors[0]]) {
      assert.doesNotMatch(String(text), /Command failed|meta_\d|AppData|yt-dlp\.exe -f/, `${c.name}: ห้ามมีบรรทัดคำสั่ง/พาธชั่วคราว`);
    }
    if (c.downloadFail) {
      assert.equal(insight.body.errorType, 'CLIP_DOWNLOAD_FAILED', `${c.name}: errorType ต้องไม่ใช่เลข exit code`);
      assert.equal(s.downloads, 1);
    }
  }
});

test('R3: ข้อความ yt-dlp ที่ส่งต่อ = บรรทัด ERROR สุดท้าย ตัดลิงก์/พาธ/เลขยาว · ไม่มี yt-dlp.exe ในเครื่อง = ถาวร', async () => {
  freshState({ downloadFail: () => ytDlpError({ stderr: `[facebook] Extracting URL: ${FB_ONE}\nERROR: [facebook] 1084395141170409: This video is only available for registered users. See C:\\Users\\User\\AppData\\Local\\Temp\\meta_1790755034291.mp4.part\n\n` }) });
  const { body } = await postInsight({ url: FB_ONE }); // humanizeErr คืนข้อความตัวโหลดทั้งก้อน (รอบ 3 M1) = เห็นตัวที่ route ส่งจริง
  // ★ รอบ 3 (M1): บรรทัดที่ไม่ใช่อาการเน็ต/ฝั่งเว็บล่ม = ถาวร → ต่อท้าย " — กดใหม่ไม่ช่วย" เสมอ
  assert.equal(body.error, 'yt-dlp โหลดวิดีโอไม่สำเร็จ: ERROR: [facebook] …: This video is only available for registered users. See — กดใหม่ไม่ช่วย');
  assert.equal(body.errorType, 'CLIP_DOWNLOAD_FAILED');

  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const exe = join(tempRoot, 'bin', 'yt-dlp.exe');
  rmSync(exe);
  try {
    const s = freshState();
    const missing = await postInsight({ url: FB_ONE });
    assert.equal(missing.status, 422);
    assert.match(missing.body.error, /ไม่พบ bin\/yt-dlp\.exe — กดใหม่ไม่ช่วย/);
    assert.equal(s.downloads, 0);
    const run = await runJobAgainst(worker, missing.status, missing.body);
    assert.deepEqual(run.statuses, ['error'], 'เครื่องไม่มีตัวโหลด = ถาวร ห้ามวนซ้ำ 80 รอบ');
  } finally {
    writeFileSync(exe, '');
  }
});

// ═══ รอบ 2 · R6: /hunt ต้องส่ง retrySafe ของ /insight ต่อ (เดิมทิ้ง → ใบ hunt ที่ล้มก่อนจ่ายเงินไม่เคยได้ลองใหม่) ═══
async function postHunt(body) {
  const { NextRequest } = await import('next/server'); // route อ่าน request.nextUrl.origin — ต้องเป็น NextRequest จริง
  const res = await settleWithin(huntRoute.POST(new NextRequest('http://localhost/api/clip-transcript/hunt', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body),
  })), 'POST /hunt ต้องตอบกลับ', 10_000);
  return { status: res.status, body: await res.json() };
}
// fetch ภายในของ /hunt → POST /insight ตัวจริงในโปรเซสเดียวกัน (ไม่ออกเน็ต)
function routeInsightFetch(calls) {
  return async (u, init = {}) => {
    const url = String(u);
    if (url === 'http://localhost/api/clip-transcript/insight') {
      calls.push(JSON.parse(init.body));
      return insightRoute.POST(new Request(url, init));
    }
    throw new Error(`ข้อสอบนี้ห้ามออกเน็ต: ${url}`);
  };
}

test('R6: /hunt บนเครื่องทีม — /insight ล้มก่อนจ่ายเงิน (retrySafe) → /hunt ส่ง retrySafe ต่อ → worker ตัวจริง (ใบ hunt) ลองใหม่', async () => {
  const s = freshState({ downloadFail: () => ytDlpError({ stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: HTTP Error 503: Service Unavailable\n' }) });
  const calls = [];
  globalThis.fetch = routeInsightFetch(calls);
  const hunt = await postHunt({ url: FB_ONE, user: 'ทดสอบ', _fromWorker: true });
  assert.equal(calls.length, 1, '/hunt ต้องยิง /insight ภายในครั้งเดียว');
  assert.equal(calls[0].url, FB_ONE);
  assert.equal(s.downloads, 1);
  assert.equal(hunt.status, 422);
  assert.equal(hunt.body.success, false);
  assert.equal(hunt.body.retrySafe, true, '/insight ยืนยันว่ายังไม่จ่าย + runTopicHunt ยังไม่รัน = ส่งต่อได้');
  assert.equal(hunt.body.errorType, 'CLIP_DOWNLOAD_FAILED');
  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const run = await runJobAgainst(worker, hunt.status, hunt.body, { kind: 'hunt' });
  assert.deepEqual(run.processUrls, ['http://clip-worker.test/api/clip-transcript/hunt']);
  assert.deepEqual(run.statuses, ['retry'], 'ใบ hunt ที่ล้มก่อนจ่ายเงินแบบชั่วคราว = ลองใหม่อัตโนมัติ');
});

test('R6: /hunt — /insight ล้มหลังเริ่มจ่าย (ไม่มี retrySafe) → /hunt ต้องไม่เติม retrySafe เอง → worker หยุด (error)', async () => {
  freshState({ brainResult: brainFail(0, 'BAD_JSON', 5000), legacyFail: preProviderFailure });
  const calls = [];
  globalThis.fetch = routeInsightFetch(calls);
  const paid = await postHunt({ url: FB_ONE, _fromWorker: true });
  assert.equal(calls.length, 1);
  assert.equal(paid.status, 422);
  assert.equal(Object.hasOwn(paid.body, 'retrySafe'), false);
  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const run = await runJobAgainst(worker, paid.status, paid.body, { kind: 'hunt' });
  assert.deepEqual(run.statuses, ['error']);
});

// ═══ รอบ 2 · R7: cleanClipUrl มี 3 สำเนา (clipUrl.js · insight route · transcript route) — ต้องได้ผลเดียวกันทุกไบต์ ═══
//   สำเนาของ transcript route ไม่ได้ export → ทดสอบผ่าน POST /api/clip-transcript ตัวจริง (ตัวถอดเสียง YouTube ถูก stub เก็บลิงก์ที่ได้รับ)
test('R7: cleanClipUrl ทั้ง 3 สำเนาได้ผลเดียวกันทุกไบต์ — ลิงก์ YouTube จริง (11 ตัว) ได้ผลเดิม · รหัสยาวผิดรูปไม่ถูกตัดเหลือ 11 ตัว', async () => {
  const cases = [
    // ลิงก์จริง (รหัส 11 ตัว) — ผลต้องเหมือนก่อนแก้ทุกไบต์
    ['https://youtu.be/Vf8UDY5EC9Q?si=abc', 'https://www.youtube.com/watch?v=Vf8UDY5EC9Q'],
    ['https://www.youtube.com/shorts/Vf8UDY5EC9Q', 'https://www.youtube.com/watch?v=Vf8UDY5EC9Q'],
    ['https://www.youtube.com/watch?v=Vf8UDY5EC9Q&feature=share', 'https://www.youtube.com/watch?v=Vf8UDY5EC9Q'],
    ['https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?si=x', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ#t=30', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=_-aB3dE4fG5&list=PL123', 'https://www.youtube.com/watch?v=_-aB3dE4fG5'],
    // รหัสยาวผิดรูป — ห้ามตัดเหลือ 11 ตัว (จะกลายเป็นคลิปอื่น/ชนใบงานอื่น) · ทั้ง 3 สำเนาต้องตรงกัน
    ['https://www.youtube.com/watch?v=clip-agent-test-first', 'https://www.youtube.com/watch?v=clip-agent-test-first'],
    ['https://youtu.be/AAAAAAAAAAAAA', 'https://youtu.be/AAAAAAAAAAAAA'],
    ['https://www.youtube.com/shorts/Vf8UDY5EC9QXYZ', 'https://www.youtube.com/shorts/Vf8UDY5EC9QXYZ'],
  ];
  for (const [raw, want] of cases) {
    assert.equal(cleanClipUrl(raw), want, `clipAgent/clipUrl.js: ${raw}`);
    assert.equal(insightRoute.cleanClipUrl(raw), want, `insight/route.js: ${raw}`);
    const s = freshState();
    const { status } = await post(transcriptRoute, '/api/clip-transcript', { url: raw });
    assert.equal(status, 200, raw);
    assert.deepEqual(s.transcribed, [want], `clip-transcript/route.js: ${raw}`);
  }
});

// ═══ ข้อ 4: รับลิงก์ต้องล้าง (ลิงก์ซ้อน 2 รอบเคยผ่านเข้าคิวแล้วไปตาย yt-dlp Command failed) ══════════
test('ข้อ 4: extractFirstUrl ตามตัวอย่างใบโจทย์ — ลิงก์ซ้อน/ข้อความปน/หลายบรรทัด/ลิงก์ปกติ/ไม่มีลิงก์', () => {
  assert.equal(extractFirstUrl(FB_TWICE), FB_ONE);
  assert.equal(extractFirstUrl('ดูคลิปนี้ https://vt.tiktok.com/x/ นะ'), 'https://vt.tiktok.com/x/');
  const twoLines = 'https://youtu.be/abc?si=1\nhttps://www.tiktok.com/@a/video/9';
  assert.equal(extractFirstUrl(twoLines), 'https://youtu.be/abc?si=1');
  assert.equal(cleanClipUrl(extractFirstUrl(twoLines)), 'https://youtu.be/abc', 'บรรทัดแรกแล้วล้าง si');
  for (const plain of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', FB_ONE, 'https://www.tiktok.com/@a/video/1?_r=1']) {
    assert.equal(extractFirstUrl(plain), plain, 'ลิงก์ปกติต้องไม่เปลี่ยน');
  }
  assert.equal(extractFirstUrl(`  ${FB_ONE}  `), FB_ONE);
  assert.equal(extractFirstUrl('"https://www.tiktok.com/@a/video/1"'), 'https://www.tiktok.com/@a/video/1');
  for (const none of ['', 'ไม่มีลิงก์เลย', 'ftp://youtube.com/video', 'https://', null, undefined, 12]) {
    assert.equal(extractFirstUrl(none), '', `ไม่มีลิงก์ http(s) ต้องได้ '' (${String(none)})`);
  }
});

test('ข้อ 4: cleanClipUrl ไม่ตัดรหัส YouTube ที่ยาวผิดรูปจนกลายเป็นคลิปอื่น · ลิงก์จริง (11 ตัว) ได้ผลเดิม', () => {
  assert.equal(cleanClipUrl('https://youtu.be/Vf8UDY5EC9Q?si=abc'), 'https://www.youtube.com/watch?v=Vf8UDY5EC9Q');
  assert.equal(cleanClipUrl('https://www.youtube.com/shorts/Vf8UDY5EC9Q'), 'https://www.youtube.com/watch?v=Vf8UDY5EC9Q');
  assert.equal(cleanClipUrl('https://www.youtube.com/watch?v=Vf8UDY5EC9Q&feature=share'), 'https://www.youtube.com/watch?v=Vf8UDY5EC9Q');
  assert.equal(cleanClipUrl('https://www.youtube.com/watch?v=clip-agent-test'), 'https://www.youtube.com/watch?v=clip-agent-test');
  assert.notEqual(cleanClipUrl('https://www.youtube.com/watch?v=clip-agent-test-first'), cleanClipUrl('https://www.youtube.com/watch?v=clip-agent-test-second'),
    'ลิงก์คนละใบต้องไม่ถูกยุบเป็นใบเดียว (คิวกันซ้ำด้วยลิงก์ที่ล้างแล้ว)');
});

test('ข้อ 4: submitClipJob — ลิงก์ซ้อน 2 รอบ (ติด fbclid) เก็บเป็นลิงก์เดียวที่ล้างแล้ว และกันซ้ำกับลิงก์เดี่ยวทั้งสองทิศ', async () => {
  const doubled = `${FB_ONE}?fbclid=AbC${FB_ONE}?fbclid=AbC`;
  const first = await submitClipJob({ url: doubled, user: 'ทดสอบ' });
  assert.equal(first.dup, false);
  assert.equal(first.platform, 'meta');
  let rows = globalThis.__co30Stores.get('clip-jobs');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, FB_ONE, 'job.url = ลิงก์เดียวที่ล้างแล้ว');
  const single = await submitClipJob({ url: FB_ONE });
  assert.equal(single.dup, true);
  assert.equal(single.jobId, first.jobId);
  const again = await submitClipJob({ url: FB_TWICE });
  assert.equal(again.dup, true);
  assert.equal(again.jobId, first.jobId);
  rows = globalThis.__co30Stores.get('clip-jobs');
  assert.equal(rows.length, 1, 'ห้ามเกิดใบงานซ้ำ');

  globalThis.__co30Stores = new Map();
  const plainFirst = await submitClipJob({ url: FB_ONE }, { strictUrl: true });
  const doubledLater = await submitClipJob({ url: FB_TWICE }, { strictUrl: true });
  assert.equal(doubledLater.dup, true, 'ลิงก์ซ้อนที่ตามมาต้องชนใบเดิม (เส้นเอเจนต์ strictUrl ด้วย)');
  assert.equal(doubledLater.jobId, plainFirst.jobId);

  const chatty = await submitClipJob({ url: 'ดูคลิปนี้ https://vt.tiktok.com/ZSabc/ นะ' });
  assert.equal(chatty.platform, 'tiktok');
  assert.equal(globalThis.__co30Stores.get('clip-jobs').find((j) => j.id === chatty.jobId).url, 'https://vt.tiktok.com/ZSabc/');
  await assert.rejects(submitClipJob({ url: 'ไม่มีลิงก์เลย' }), (e) => e.errorType === 'BAD_URL');
  await assert.rejects(submitClipJob({ url: 12 }), (e) => e.errorType === 'BAD_URL');
});

test('ข้อ 4: POST /insight รับลิงก์ซ้อน → yt-dlp และเครื่องยนต์ใหม่ได้ลิงก์เดียว · ลิงก์ YouTube ไม่มี https ยังใช้ได้เหมือนเดิม', async () => {
  const s = globalThis.__co30;
  const { status } = await postInsight({ url: FB_TWICE });
  assert.equal(status, 200);
  assert.deepEqual(s.downloadedUrls, [FB_ONE], 'yt-dlp ต้องได้ลิงก์เดียว (เดิมได้ลิงก์ซ้อน → Command failed)');
  assert.equal(s.brain[0].url, FB_ONE);

  const bare = freshState();
  const { status: bareStatus } = await postInsight({ url: 'youtu.be/dQw4w9WgXcQ' });
  assert.equal(bareStatus, 200, 'ไม่มี http(s):// = ใช้ข้อความเดิมล้างตามเดิม (ไม่กลายเป็นลิงก์ไม่รองรับ)');
  assert.equal(bare.brain[0].url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('ข้อ 4: /api/clip-transcript (ถอดเสียง) รับลิงก์ซ้อน → ตัวถอดเสียงได้ลิงก์เดียว', async () => {
  const s = globalThis.__co30;
  const once = 'https://www.tiktok.com/@a/video/1';
  const { status, body } = await post(transcriptRoute, '/api/clip-transcript', { url: once + once });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(s.transcribed, [once]);
});

test('ข้อ 4: /hunt บนคลาวด์รับลิงก์ซ้อน → ใบงานที่ส่งเข้าคิวเครื่องทีมเก็บลิงก์เดียว', async () => {
  setPlatform('linux');
  const { status, body } = await post(huntRoute, '/api/clip-transcript/hunt', { url: FB_TWICE, user: 'ทดสอบ' });
  assert.equal(status, 200);
  assert.equal(body.queued, true);
  const jobs = globalThis.__co30Stores.get('clip-jobs');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, FB_ONE);
  assert.equal(jobs[0].kind, 'hunt');
});

// ═══ รอบ 2 · R9: extractFirstUrl ปรับขอบ — ตัดที่อักขระนอก ASCII + เครื่องหมายท้ายที่ค้าง · ลิงก์ห่อ l.php คงพฤติกรรมเดิม ═══
test('R9 (1): อักขระนอก ASCII ติดท้ายลิงก์ (ไทย · … · zero-width) → ตัดออก เหลือลิงก์ล้วน', () => {
  const ZERO_WIDTH = String.fromCharCode(0x200b);
  assert.equal(extractFirstUrl('https://vt.tiktok.com/ZSabc/ดูด่วน'), 'https://vt.tiktok.com/ZSabc/');
  assert.equal(extractFirstUrl(`${FB_ONE}นะคะ`), FB_ONE);
  assert.equal(extractFirstUrl('ดูอันนี้https://www.tiktok.com/@a/video/1ตลกมาก'), 'https://www.tiktok.com/@a/video/1');
  assert.equal(extractFirstUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ…'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(extractFirstUrl(`https://youtu.be/dQw4w9WgXcQ${ZERO_WIDTH}`), 'https://youtu.be/dQw4w9WgXcQ');
});

test('R9 (2): เครื่องหมายท้ายที่ค้าง ,;.)]}> → ตัดออก (ลิงก์ในวงเล็บ/ท้ายประโยค) · ลิงก์ปกติไม่เปลี่ยน', () => {
  assert.equal(extractFirstUrl('ดูคลิปนี้ (https://youtu.be/dQw4w9WgXcQ).'), 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(extractFirstUrl('https://www.tiktok.com/@a/video/1,'), 'https://www.tiktok.com/@a/video/1');
  assert.equal(extractFirstUrl('https://www.tiktok.com/@a/video/1;'), 'https://www.tiktok.com/@a/video/1');
  assert.equal(extractFirstUrl('[https://youtu.be/dQw4w9WgXcQ]'), 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(extractFirstUrl('{https://youtu.be/dQw4w9WgXcQ}'), 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(extractFirstUrl(`<${FB_ONE}>`), FB_ONE);
  assert.equal(extractFirstUrl('https://www.facebook.com/watch/?v=123456789012345.'), 'https://www.facebook.com/watch/?v=123456789012345');
  assert.equal(extractFirstUrl('https://.'), '', 'เหลือแต่ https:// = ไม่มีลิงก์');
  for (const plain of ['https://www.tiktok.com/@a/video/1?_r=1', 'https://vt.tiktok.com/ZSabc/', FB_ONE]) {
    assert.equal(extractFirstUrl(plain), plain, 'ลิงก์ปกติต้องไม่เปลี่ยน');
  }
});

test('R9 (3) → รอบ 3 (L6): ลิงก์ห่อ l.php?u=https://… (ไม่เข้ารหัส) ถูกแกะเป็นลิงก์ข้างใน · แบบเข้ารหัสก็ถูกแกะ · ผ่านคิวได้ลิงก์ล้วน', async () => {
  // ★ รอบ 3 (L6): เลิกตัดที่ http ตัวที่สอง (เดิมได้ "…/l.php?u=" ซึ่งไปล้มตอนโหลด) — แกะเป็นลิงก์ข้างในทั้งสองแบบ
  assert.equal(extractFirstUrl('https://l.facebook.com/l.php?u=https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const encoded = 'https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&h=AT0';
  assert.equal(extractFirstUrl(encoded), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  // ปลายทางคิว: ลิงก์ติดไทย/วงเล็บ → ใบงานเก็บลิงก์ล้วน และกันซ้ำกับลิงก์เดี่ยว
  const glued = await submitClipJob({ url: `(${FB_ONE}นะคะ).` });
  assert.equal(glued.platform, 'meta');
  assert.equal(globalThis.__co30Stores.get('clip-jobs').find((j) => j.id === glued.jobId).url, FB_ONE);
  const plain = await submitClipJob({ url: FB_ONE });
  assert.equal(plain.dup, true);
  assert.equal(plain.jobId, glued.jobId);
});

// ═══ รอบ 3 · M1: _ytDlpFailure ตัดสินถาวร/ชั่วคราวเอง — คำ parse/unavailable ในบรรทัด stderr ห้ามพา worker วนซ้ำ ═══════
//   isTransient ของ worker ล็อก (ชั่วคราวมีคำ parse/unavailable/503 · ถาวรชั้นท้ายมี "โหลดวิดีโอ…ไม่สำเร็จ") → ต้นทางต้องใส่คำตัดสินให้ชัด
const YTDLP_REPORT = 'please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template. Confirm you are on the latest version using  yt-dlp -U';
// spawn ล้มแบบ node จริง (โปรเซสไม่ได้เริ่ม): stderr ว่าง · message "spawn <exe> <code>" · code = ชื่อ errno
function spawnError(code) {
  const exe = 'C:\\tmp\\clip-brain-lab\\bin\\yt-dlp.exe';
  return Object.assign(new Error(`spawn ${exe} ${code}`), {
    code, errno: -4092, syscall: `spawn ${exe}`, path: exe, spawnargs: ['-f', 'mp4/best[ext=mp4]/best', FB_ONE], stdout: '', stderr: '',
  });
}

test('M1: yt-dlp ล้ม → POST /insight จริง → worker ตัวจริง — ถาวรต่อท้าย "กดใหม่ไม่ช่วย" ชนะคำ parse/unavailable · ชั่วคราวเฉพาะเน็ต/เว็บล่ม/ถูกฆ่า/spawn ถูกล็อก', async () => {
  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const cases = [
    // ถาวร — รอบ 2 หลุดเป็นชั่วคราวเพราะคำ parse / unavailable (หรือ humanizeErr แปลงเป็น "Gemini มีคนใช้งานหนัก")
    { name: 'Cannot parse data (ตัวแยกข้อมูลของ yt-dlp พัง)', want: 'error',
      fail: () => ytDlpError({ stderr: `ERROR: [facebook] 1084395141170409: Cannot parse data; ${YTDLP_REPORT}\n` }) },
    { name: 'Failed to parse JSON', want: 'error',
      fail: () => ytDlpError({ stderr: `ERROR: [facebook] 1084395141170409: Failed to parse JSON (caused by JSONDecodeError("Expecting value in '': line 1 column 1 (char 0)")); ${YTDLP_REPORT}\n` }) },
    { name: 'Video unavailable', want: 'error',
      fail: () => ytDlpError({ stderr: "ERROR: [facebook] 1084395141170409: Video unavailable. This content isn't available right now\n" }) },
    { name: 'Unsupported URL', want: 'error',
      fail: () => ytDlpError({ stderr: `ERROR: Unsupported URL: ${FB_ONE}\n` }) },
    { name: 'คำ timeout/network อยู่แค่ในลิงก์ (ชื่อเพจ) — ตัดสินหลังตัดลิงก์', want: 'error',
      fail: () => ytDlpError({ stderr: 'ERROR: Unsupported URL: https://www.facebook.com/timeoutnetwork/videos/1084395141170409\n' }) },
    { name: 'บรรทัด ERROR ไม่ใช่บรรทัดสุดท้าย (บรรทัดท้ายมีคำ network) — ต้องเลือกบรรทัด ERROR', want: 'error',
      fail: () => ytDlpError({ stderr: `ERROR: [facebook] 1084395141170409: Cannot parse data; ${YTDLP_REPORT}\n[debug] network: proxy none, retries 10\n` }) },
    { name: 'stderr ว่าง + exit 1 (ไม่รู้สาเหตุ)', want: 'error', fail: () => ytDlpError({ stderr: '' }) },
    // ชั่วคราว
    { name: 'HTTP Error 503', want: 'retry',
      fail: () => ytDlpError({ stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: HTTP Error 503: Service Unavailable (caused by <HTTPError 503: Service Unavailable>)\n' }) },
    { name: 'HTTP Error 502 (บรรทัดไม่มีคำที่ worker รู้จัก — พึ่งคำท้าย "เดี๋ยวก็ผ่าน")', want: 'retry',
      fail: () => ytDlpError({ stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: HTTP Error 502: Bad Gateway (caused by <HTTPError 502: Bad Gateway>)\n' }) },
    { name: 'Connection aborted/reset (WinError 10054)', want: 'retry',
      fail: () => ytDlpError({ stderr: "ERROR: [facebook] 1084395141170409: Unable to download webpage: ('Connection aborted.', ConnectionResetError(10054, 'An existing connection was forcibly closed by the remote host', None, 10054, None))\n" }) },
    { name: 'DNS getaddrinfo', want: 'retry',
      fail: () => ytDlpError({ stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>\n' }) },
    { name: 'ถูกฆ่าเพราะหมดเวลา', want: 'retry', fail: () => ytDlpError({ code: null, killed: true, signal: 'SIGTERM', stderr: '' }) },
    { name: 'stderr ว่าง + spawn EACCES (ไฟล์ถูกล็อก)', want: 'retry', fail: () => spawnError('EACCES') },
    { name: 'stderr ว่าง + spawn EBUSY', want: 'retry', fail: () => spawnError('EBUSY') },
  ];
  for (const c of cases) {
    const s = freshState({ downloadFail: c.fail });
    const insight = await postInsight({ url: FB_ONE });
    const msg = String(insight.body.error);
    assert.equal(insight.status, 422, c.name);
    assert.equal(insight.body.retrySafe, true, `${c.name}: ล้มตอนโหลด = ยังไม่จ่ายค่าโมเดล`);
    assert.equal(insight.body.errorType, 'CLIP_DOWNLOAD_FAILED', c.name);
    assert.equal(s.downloads, 1, c.name);
    assert.match(msg, /^yt-dlp โหลดวิดีโอไม่สำเร็จ/, `${c.name}: humanizeErr ต้องคืนข้อความตัวโหลดทั้งก้อน (ได้: ${msg})`);
    assert.doesNotMatch(msg, /Gemini/, `${c.name}: ปัญหาอยู่ที่ตัวโหลด ห้ามโทษ Gemini (ได้: ${msg})`);
    assert.doesNotMatch(msg, /Command failed: |meta_\d|AppData|yt-dlp\.exe|https?:\/\//, `${c.name}: ห้ามมีบรรทัดคำสั่ง/พาธ/ลิงก์ (ได้: ${msg})`);
    if (c.want === 'error') assert.match(msg, / — กดใหม่ไม่ช่วย$/, `${c.name}: ถาวรต้องต่อท้าย "กดใหม่ไม่ช่วย" (ได้: ${msg})`);
    else assert.match(msg, /^yt-dlp โหลดวิดีโอไม่สำเร็จ \(ชั่วคราว: .+\) — ลองใหม่ได้ เดี๋ยวก็ผ่าน$/, `${c.name}: (ได้: ${msg})`);
    const run = await runJobAgainst(worker, insight.status, insight.body);
    assert.deepEqual(run.statuses, [c.want], `${c.name}: worker ต้องรายงาน ${c.want} (ได้ ${run.statuses}) · ข้อความ: ${msg}`);
  }
});

test('M1: ข้อความจริงที่ route ส่ง — ถูกฆ่า = timeout + เวลาจริง (ไม่ใช่ "~4.5 นาที") · Unsupported URL ไม่กลายเป็น "Gemini เปิดดูคลิปนี้ไม่ได้" · stderr ว่าง = รหัส+ข้อความบรรทัดแรก', async () => {
  freshState({ downloadFail: () => ytDlpError({ code: null, killed: true, signal: 'SIGTERM', stderr: '' }) });
  const killed = await postInsight({ url: FB_ONE });
  assert.equal(killed.body.error, 'yt-dlp โหลดวิดีโอไม่สำเร็จ (ชั่วคราว: timeout 180 วิ) — ลองใหม่ได้ เดี๋ยวก็ผ่าน');
  assert.doesNotMatch(killed.body.error, /4\.5 นาที/);

  freshState({ downloadFail: () => ytDlpError({ stderr: `ERROR: Unsupported URL: ${FB_ONE}\n` }) });
  const unsupported = await postInsight({ url: FB_ONE });
  assert.equal(unsupported.body.error, 'yt-dlp โหลดวิดีโอไม่สำเร็จ: ERROR: Unsupported URL: — กดใหม่ไม่ช่วย');
  assert.doesNotMatch(unsupported.body.error, /Gemini เปิดดูคลิปนี้ไม่ได้/);

  freshState({ downloadFail: () => spawnError('EACCES') });
  const locked = await postInsight({ url: FB_ONE });
  assert.equal(locked.body.error, 'yt-dlp โหลดวิดีโอไม่สำเร็จ (ชั่วคราว: EACCES spawn EACCES) — ลองใหม่ได้ เดี๋ยวก็ผ่าน');

  freshState({ downloadFail: () => ytDlpError({ stderr: '' }) });
  const exit1 = await postInsight({ url: FB_ONE });
  assert.equal(exit1.body.error, 'yt-dlp โหลดวิดีโอไม่สำเร็จ: 1 Command failed — กดใหม่ไม่ช่วย', 'ตัดบรรทัดคำสั่ง (พาธ/อาร์กิวเมนต์/ลิงก์) ทิ้งทั้งหมด');
});

// ═══ รอบ 3 · M2: yt-dlp เขียนลงโฟลเดอร์ชั่วคราวต่อการโหลด แล้วลบทั้งโฟลเดอร์เสมอ + เพดานเวลาจาก env ═══════════════
const clipdlDirs = () => readdirSync(tempRoot).filter((name) => name.startsWith('clipdl-'));
// ไฟล์ของ yt-dlp ที่ค้างที่ไหนก็ได้ใต้ temp ของข้อสอบ (ไม่ใช่แค่ในโฟลเดอร์ clipdl-*): .part · DASH .f<รหัส>.* · .ytdl · video.mp4 · meta_<เวลา>.mp4 (ทรงรอบ 2)
const strayDownloads = () => readdirSync(tempRoot, { recursive: true }).map(String)
  .filter((p) => /\.part$|\.ytdl$|\.f\d+\.(mp4|m4a)$|(^|[\\/])(video|meta_\d+)\.mp4$/.test(p));
const downloadLeftoversOnDisk = () => [...clipdlDirs(), ...strayDownloads()];
const ytDlpDownloadCall = (s) => s.execCalls.find((c) => /yt-dlp/i.test(c.cmd) && !c.args.includes('--get-duration'));
const ytDlpOutPath = (s) => { const { args } = ytDlpDownloadCall(s); return args[args.indexOf('-o') + 1]; };

test('M2: yt-dlp ถูกฆ่ากลางทาง (ทิ้ง .part/DASH/.ytdl) → หลัง POST จบไม่มีโฟลเดอร์ clipdl-* หรือไฟล์ .part/.ytdl/meta_* ค้างใน temp · สำเร็จ/ล้มถาวร/ไฟล์เล็กเกินก็ไม่ค้าง', async () => {
  const leftovers = ['video.mp4.part', 'video.f137.mp4.part', 'video.f140.m4a', 'video.mp4.ytdl'];
  assert.deepEqual(downloadLeftoversOnDisk(), [], 'ก่อนเริ่มต้องไม่มีโฟลเดอร์ค้างจากข้อสอบอื่น');

  const killed = freshState({ downloadLeftovers: leftovers, downloadFail: () => ytDlpError({ code: null, killed: true, signal: 'SIGTERM', stderr: '' }) });
  const r1 = await postInsight({ url: FB_ONE });
  assert.equal(r1.status, 422);
  assert.equal(r1.body.retrySafe, true);
  const out1 = ytDlpOutPath(killed);
  assert.equal(basename(out1), 'video.mp4', 'yt-dlp เขียนชื่อคงที่ในโฟลเดอร์ของรอบนั้น');
  assert.match(basename(dirname(out1)), /^clipdl-/);
  assert.equal(resolvePath(dirname(dirname(out1))), resolvePath(tempRoot), 'โฟลเดอร์ต่อการโหลดต้องอยู่ใต้ os.tmpdir()');
  assert.equal(existsSync(dirname(out1)), false, 'ถูกฆ่ากลางทาง: ต้องลบทั้งโฟลเดอร์ (รวม .part/DASH/.ytdl)');
  assert.deepEqual(downloadLeftoversOnDisk(), []);

  const ok = freshState({ downloadLeftovers: leftovers });
  const r2 = await postInsight({ url: FB_ONE });
  assert.equal(r2.status, 200);
  assert.equal(ok.brain[0].videoBuffer.length, MB, 'สำเร็จ: อ่านไฟล์ที่โหลดครบก่อนลบโฟลเดอร์');
  assert.notEqual(dirname(ytDlpOutPath(ok)), dirname(out1), 'โหลด 1 ครั้ง = โฟลเดอร์ใหม่ 1 โฟลเดอร์');
  assert.deepEqual(downloadLeftoversOnDisk(), [], 'สำเร็จก็ต้องไม่ทิ้งโฟลเดอร์ค้าง');

  freshState({ downloadLeftovers: leftovers, downloadFail: () => ytDlpError({ stderr: `ERROR: Unsupported URL: ${FB_ONE}\n` }) });
  const r3 = await postInsight({ url: FB_ONE });
  assert.equal(r3.status, 422);
  assert.deepEqual(downloadLeftoversOnDisk(), [], 'ล้มถาวรก็ต้องไม่ทิ้งโฟลเดอร์ค้าง');

  freshState({ downloadLeftovers: leftovers, downloadBytes: 5_000 });
  const r4 = await postInsight({ url: FB_ONE });
  assert.equal(r4.status, 422);
  assert.match(r4.body.error, /วิดีโอเล็กเกินไป/);
  assert.deepEqual(downloadLeftoversOnDisk(), [], 'โยนหลังอ่านไฟล์ก็ต้องไม่ทิ้งโฟลเดอร์ค้าง');
});

test('M2: เพดานเวลา yt-dlp จาก env CLIP_YTDLP_TIMEOUT_MS — ค่าเริ่มต้น 180 วิ · กรอบ 30 วิ–30 นาที · ค่าเสียใช้ค่าเริ่มต้น · ข้อความ timeout บอกค่าที่ใช้จริง', async () => {
  const cases = [
    [undefined, 180_000], ['', 180_000], ['abc', 180_000], ['0', 180_000], ['-5', 180_000],
    ['5', 30_000], ['29999', 30_000], ['30000', 30_000], ['600000', 600_000], ['1800000', 1_800_000], ['99999999', 1_800_000],
  ];
  for (const [value, want] of cases) {
    const s = freshState({ downloadFail: () => ytDlpError({ code: null, killed: true, signal: 'SIGTERM', stderr: '' }) });
    if (value === undefined) delete process.env.CLIP_YTDLP_TIMEOUT_MS;
    else process.env.CLIP_YTDLP_TIMEOUT_MS = value;
    const { status, body } = await postInsight({ url: FB_ONE });
    assert.equal(status, 422);
    assert.equal(ytDlpDownloadCall(s).opts.timeout, want, `CLIP_YTDLP_TIMEOUT_MS=${value} → เพดานเวลาของ execFile`);
    assert.equal(ytDlpDownloadCall(s).opts.maxBuffer, 20 * MB, 'maxBuffer คงเดิม');
    assert.equal(body.error, `yt-dlp โหลดวิดีโอไม่สำเร็จ (ชั่วคราว: timeout ${want / 1000} วิ) — ลองใหม่ได้ เดี๋ยวก็ผ่าน`);
  }
});

// ═══ รอบ 3 · L2: tikwm จำกัดความถี่ = ชั่วคราว (รอบ 2 รวบเป็น "ไม่พบวิดีโอ — กดใหม่ไม่ช่วย") ═══════════════════
test('L2: tikwm ติดเพดานความถี่/ไม่ว่าง → 422 retrySafe · ข้อความ tikwm ไม่ถูกแปลงเป็น "Gemini …" · worker ตัวจริงลองใหม่ · โพสต์รูป/ลิงก์เสียยังถาวร', async () => {
  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const cases = [
    { name: 'Free Api Limit (คำตอบจริงของ tikwm)', want: 'retry', api: { code: -1, msg: 'Free Api Limit: 1 request/second.', processed_time: 0.0021 } },
    { name: 'Too many requests / try again', want: 'retry', api: { code: -1, msg: 'Too many requests. Please try again later.' } },
    { name: 'Server busy', want: 'retry', api: { code: -1, msg: 'Server is busy' } },
    { name: 'โพสต์รูป (ไม่มีลิงก์วิดีโอ)', want: 'error', api: { code: 0, msg: 'success', data: { images: ['https://cdn.tiktok.test/1.jpg'] } } },
    { name: 'Url parsing is failed', want: 'error', api: { code: -1, msg: 'Url parsing is failed! Please check url.' } },
  ];
  for (const c of cases) {
    const s = freshState();
    globalThis.fetch = tikwmFetch({ api: c.api, video: async () => { throw new Error('ไม่มีลิงก์วิดีโอ — ห้ามโหลดไฟล์'); } });
    const insight = await postInsight({ url: TIKTOK_URL });
    const msg = String(insight.body.error);
    assert.equal(insight.status, 422, c.name);
    assert.equal(insight.body.retrySafe, true, `${c.name}: ยังไม่จ่ายค่าโมเดล`);
    assert.equal(s.brain.length + s.legacy.length, 0, c.name);
    assert.match(msg, /^tikwm/, `${c.name}: humanizeErr ต้องไม่แปลงข้อความ tikwm (ได้: ${msg})`);
    assert.doesNotMatch(msg, /Gemini/, `${c.name}: ปัญหาอยู่ที่ tikwm ห้ามโทษ Gemini (ได้: ${msg})`);
    if (c.want === 'retry') assert.equal(msg, `tikwm แน่นชั่วคราว (rate limit: ${c.api.msg})`);
    else assert.match(msg, / — กดใหม่ไม่ช่วย$/, `${c.name}: (ได้: ${msg})`);
    const run = await runJobAgainst(worker, insight.status, insight.body);
    assert.deepEqual(run.statuses, [c.want], `${c.name}: worker ต้องรายงาน ${c.want} (ได้ ${run.statuses}) · ข้อความ: ${msg}`);
  }
});

// ═══ รอบ 3 · L4: ข้อความ PROCESSING ต้องไม่สัญญา "ลองใหม่อัตโนมัติ" ในเส้นที่ระบบจะไม่ลองให้ ═══════════════════
//   YouTube บนเครื่องทีม: เครื่องยนต์ใหม่ดูลิงก์ (จ่ายแล้วล้ม) → เครื่องยนต์เดิมโหลดไฟล์เอง >19MB → Files API รอไม่ทัน
test('L4 → รอบ 4 (F2): YouTube — เครื่องยนต์ใหม่จ่ายแล้ว/พังผิดคาด → เครื่องยนต์เดิมรอไฟล์บน Gemini ไม่ทัน → ไม่มี retrySafe · ข้อความบอก "ไม่ลองซ้ำเอง" ไม่สัญญาว่าลองใหม่ให้ · ยังไม่จ่าย (ส่ง retrySafe) = ข้อความรอบ 3 เดิม', async () => {
  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const NO_AUTO_RETRY = 'Gemini ใช้เวลาประมวลผลไฟล์วิดีโอนานเกินที่รอ (timeout) — ระบบไม่ลองซ้ำเอง (กันจ่ายซ้ำ) กดส่งใหม่เองได้';
  const QUEUE_RETRIES = 'Gemini ใช้เวลาประมวลผลไฟล์วิดีโอนานเกินที่รอ (timeout) — ถ้าส่งผ่านคิวเครื่องทีม ระบบจะลองใหม่ให้เอง · ถ้าถอดตรงให้กดส่งเข้าคิว';
  const cases = [
    { name: 'เครื่องยนต์ใหม่ใช้ไป 1234 token แล้วล้ม', brainResult: brainFail(1234), sendsRetrySafe: false },
    { name: 'เครื่องยนต์ใหม่พังผิดคาด (ไม่รู้ยอด = ถือว่าจ่ายแล้ว)', brainResult: () => { throw new Error('สมองพังกลางทาง'); }, sendsRetrySafe: false },
    { name: 'เครื่องยนต์ใหม่ล้มก่อนถึงผู้ให้บริการ (NO_KEY · 0 token)', brainResult: brainFail(0, 'NO_KEY'), sendsRetrySafe: true },
  ];
  for (const c of cases) {
    const s = freshState({ brainResult: c.brainResult, downloadBytes: 20 * MB });
    s.files.states = ['PROCESSING'];
    s.legacyImpl = (buf) => gemini.callGeminiVideoFile({
      prompt: 'ถอดคลิปทดสอบ', videoBuffer: buf, maxAttempts: 1, allowModelFallback: false, _fileWait: { waitMs: 60, pollMs: 5 },
    });
    const insight = await postInsight({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    assert.equal(insight.status, 422, c.name);
    assert.equal(s.brain.length, 1, c.name);
    assert.equal(s.brain[0].isYouTube, true, `${c.name}: เครื่องยนต์ใหม่ดูลิงก์ YouTube`);
    assert.equal(s.legacy.length, 1, c.name);
    assert.equal(s.legacy[0].buf.length, 20 * MB, `${c.name}: เครื่องยนต์เดิมบนเครื่องทีมโหลด YouTube เอง (บีบไม่ลง = เส้น Files API)`);
    assert.equal(s.files.uploads.length, 1, c.name);
    assert.equal(s.gen.calls.length, 0, `${c.name}: รอไม่ทัน = ยังไม่ยิงโมเดล`);
    assert.equal(Object.hasOwn(insight.body, 'retrySafe'), c.sendsRetrySafe, c.name);
    assert.match(insight.body.error, /\(timeout\)/, `${c.name}: คงคำ timeout`);
    const run = await runJobAgainst(worker, insight.status, insight.body);
    if (c.sendsRetrySafe) {
      assert.equal(insight.body.error, QUEUE_RETRIES, `${c.name}: ส่ง retrySafe = ข้อความรอบ 3 เดิม`);
      assert.deepEqual(run.statuses, ['retry'], `${c.name}: worker ลองใหม่ให้จริงตามที่ข้อความบอก`);
    } else {
      // ★ รอบ 4 (F2): ไม่ส่ง retrySafe = worker ไม่ลองซ้ำแน่นอน → ข้อความต้องบอกตรงๆ (รอบ 3 ยังสัญญา "ระบบจะลองใหม่ให้เอง")
      assert.equal(insight.body.error, NO_AUTO_RETRY, `${c.name}: ต้องบอกว่าไม่ลองซ้ำเอง`);
      assert.match(insight.body.error, /ไม่ลองซ้ำเอง/);
      assert.doesNotMatch(insight.body.error, /ลองใหม่ให้เอง|ลองใหม่อัตโนมัติ/, `${c.name}: เส้นนี้ระบบจะไม่ลองใหม่เอง — ห้ามสัญญา`);
      assert.deepEqual(run.statuses, ['error'], `${c.name}: ไม่มี retrySafe = worker ไม่ลองซ้ำเอง`);
      assert.match(run.finalLog, /❌ ล้มหลังเริ่มยิง AI แล้ว — ไม่ลองซ้ำอัตโนมัติ \(กันจ่ายซ้ำ\) กดส่งใหม่เองได้/);
    }
  }
});

// ═══ รอบ 3 · L6: แกะลิงก์ห่อของเฟซบุ๊ก/เมสเซนเจอร์ (3 ใน 45 ใบที่ล้มจริงเป็น l.facebook.com/l.php?u=…) ═══════════════
const TT_SHORT = 'https://vt.tiktok.com/ZSabc123/';
test('L6: ลิงก์ห่อแบบเข้ารหัส (l./lm.facebook.com · l.messenger.com) → ลิงก์จริงข้างใน · สูงสุด 2 ชั้น · decode ล้ม/ไม่ใช่ http/ไม่มี u = คงเดิม · host อื่นไม่แตะ', () => {
  assert.equal(extractFirstUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fvt.tiktok.com%2FZSabc123%2F&h=AT0abc&__tn__=-UK-R&c[0]=AT1'), TT_SHORT);
  assert.equal(extractFirstUrl('https://lm.facebook.com/l.php?u=https%3A%2F%2Fvt.tiktok.com%2FZSabc123%2F&h=AT0'), TT_SHORT);
  assert.equal(extractFirstUrl('https://l.messenger.com/l.php?u=https%3A%2F%2Fvt.tiktok.com%2FZSabc123%2F&h=AT0'), TT_SHORT);
  assert.equal(extractFirstUrl('https://l.facebook.com/l.php?h=AT0&u=https%3A%2F%2Fvt.tiktok.com%2FZSabc123%2F'), TT_SHORT, 'u ไม่ใช่พารามิเตอร์แรกก็แกะได้');
  assert.equal(extractFirstUrl('ดูอันนี้ https://l.facebook.com/l.php?u=https%3A%2F%2Fvt.tiktok.com%2FZSabc123%2F&h=AT0 นะคะ'), TT_SHORT, 'มีข้อความปน');
  // 2 ชั้น (ห่อซ้อนห่อ — ค่า u ชั้นในถูกเข้ารหัสซ้ำ) → แกะถึงลิงก์จริง · 3 ชั้น → หยุดที่ชั้นที่ 2 (มีเพดาน ไม่วนไม่จบ)
  const level1 = `https://lm.facebook.com/l.php?u=${encodeURIComponent(TT_SHORT)}&h=AT1`;
  const level2 = `https://l.facebook.com/l.php?u=${encodeURIComponent(level1)}&h=AT0`;
  assert.equal(extractFirstUrl(level2), TT_SHORT);
  assert.equal(extractFirstUrl(`https://l.facebook.com/l.php?u=${encodeURIComponent(level2)}`), level1, 'แกะได้สูงสุด 2 ชั้น');
  // แกะไม่ได้ = คงลิงก์เดิม
  for (const keep of [
    'https://l.facebook.com/l.php?u=https%E0%B8&h=AT0',            // decodeURIComponent ล้ม (UTF-8 ขาดท้าย)
    'https://l.facebook.com/l.php?u=fb%3A%2F%2Fprofile%2F123&h=AT0', // ข้างในไม่ใช่ลิงก์ http(s)
    'https://l.facebook.com/l.php?h=AT0',                            // ไม่มี u
    'https://www.facebook.com/watch/?u=https%3A%2F%2Fvt.tiktok.com%2Fx%2F', // ★ รอบ 4 (F5-ข): www.facebook.com เป็นตัวห่อเฉพาะพาธ /l.php (เดิมบรรทัดนี้คือ /l.php ซึ่งตอนนี้ถูกแกะ — ดูข้อสอบ F5)
  ]) assert.equal(extractFirstUrl(keep), keep, keep);
  // YouTube ในลิงก์ห่อ → cleanClipUrl ได้ลิงก์มาตรฐาน
  assert.equal(cleanClipUrl(extractFirstUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ%3Fsi%3Dabc&h=AT0')),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('L6: ลิงก์ห่อไม่เข้ารหัส (u=https://…) → ลิงก์ข้างใน · พารามิเตอร์ตัวห่อ (&h=…) ท้ายลิงก์ที่ไม่มี "?" ถูกตัด · ลิงก์ที่มี "?" คงพารามิเตอร์ของตัวเอง', () => {
  assert.equal(extractFirstUrl(`https://l.facebook.com/l.php?u=${TT_SHORT}`), TT_SHORT);
  assert.equal(extractFirstUrl(`https://l.facebook.com/l.php?u=${TT_SHORT}&h=AT0abc&__tn__=-UK-R`), TT_SHORT, '&h= เป็นของตัวห่อ ไม่ใช่พาธของลิงก์จริง');
  assert.equal(extractFirstUrl(`https://lm.facebook.com/l.php?h=AT0&u=${TT_SHORT}`), TT_SHORT);
  // ★ รอบ 4 (F5-ค): ลิงก์จริงมี "?" → พารามิเตอร์ของลิงก์จริงคงไว้ (is_from_webapp) แต่ของตัวห่อ (h) ถูกลบ — รอบ 3 เคยคง &h=AT0 ไว้
  assert.equal(extractFirstUrl('ดูนี่ (https://l.messenger.com/l.php?u=https://www.tiktok.com/@a/video/123?is_from_webapp=1&h=AT0).'),
    'https://www.tiktok.com/@a/video/123?is_from_webapp=1', 'ลิงก์จริงมี "?" = พารามิเตอร์ของตัวเองคงไว้ · h ของตัวห่อถูกลบ');
  assert.equal(extractFirstUrl(`https://l.facebook.com/l.php?u=${TT_SHORT}https://l.facebook.com/l.php?u=${TT_SHORT}`), TT_SHORT, 'ลิงก์ห่อวางซ้อน 2 รอบ');
  assert.equal(extractFirstUrl(`https://l.facebook.com/l.php?u=${TT_SHORT}นะคะ`), TT_SHORT, 'ไทยติดท้าย');
});

test('L6 (ปลายทาง): ลิงก์ห่อ → submitClipJob เก็บ vt.tiktok ล้วน platform=tiktok (ทั้งเส้นเว็บและเอเจนต์) กันซ้ำกับลิงก์ตรง · POST /insight ส่งลิงก์จริงให้ tikwm', async () => {
  const wrapped = 'https://l.facebook.com/l.php?u=https%3A%2F%2Fvt.tiktok.com%2FZSabc123%2F%3Ffbclid%3DIwAR0xyz&h=AT0abc';
  const rowUrl = (jobId) => globalThis.__co30Stores.get('clip-jobs').find((j) => j.id === jobId).url;
  const job = await submitClipJob({ url: wrapped, user: 'ทดสอบ' });
  assert.equal(job.dup, false);
  assert.equal(job.platform, 'tiktok');
  assert.equal(rowUrl(job.jobId), TT_SHORT, 'job.url = ลิงก์จริงที่ล้าง fbclid แล้ว (เดิมเก็บลิงก์ห่อ → tikwm "Url parsing is failed")');
  const direct = await submitClipJob({ url: TT_SHORT });
  assert.equal(direct.dup, true, 'ลิงก์ห่อกับลิงก์ตรงคือคลิปเดียวกัน');
  assert.equal(direct.jobId, job.jobId);
  const bare = await submitClipJob({ url: `https://l.facebook.com/l.php?u=${TT_SHORT}&h=AT0` });
  assert.equal(bare.dup, true, 'ลิงก์ห่อไม่เข้ารหัสก็ชนใบเดิม');

  globalThis.__co30Stores = new Map();
  const agent = await submitClipJob({ url: wrapped }, { strictUrl: true });
  assert.equal(agent.platform, 'tiktok', 'เส้นเอเจนต์ตรวจ hostname จริง — ลิงก์ห่อ (l.facebook.com) เคยได้ meta');
  assert.equal(rowUrl(agent.jobId), TT_SHORT);

  const s = freshState();
  const fetched = [];
  globalThis.fetch = async (u) => {
    fetched.push(String(u));
    if (String(u).includes('tikwm.com')) return new Response(JSON.stringify({ data: { play: 'https://cdn.tiktok.test/v.mp4' } }));
    return new Response(Buffer.alloc(2 * MB, 3));
  };
  const { status } = await postInsight({ url: wrapped });
  assert.equal(status, 200);
  assert.equal(new URL(fetched[0]).searchParams.get('url'), TT_SHORT, 'tikwm ต้องได้ลิงก์จริง ไม่ใช่ลิงก์ห่อของเฟซบุ๊ก');
  assert.equal(s.brain[0].url, TT_SHORT);
  assert.equal(s.brain[0].videoBuffer.length, 2 * MB);
});

// ═══ รอบ 4 · F1: ลบโฟลเดอร์ชั่วคราวต้องลองซ้ำเมื่อไฟล์ยังถูกถือ (พิสูจน์บน Windows จริง: ฆ่า yt-dlp แล้ว rm โดน EBUSY 2–3 วิ) ═══════
//   rm ปลอม (STUBS['fs-promises']) เลียนสัญญา maxRetries ของ Node · ตรวจค่าที่ route ส่งจริง + ผลปลายทาง (โฟลเดอร์หาย/ค้าง · log · คำตอบ POST)
function rmControl(overrides = {}) {
  const ctl = { calls: [], attempts: 0, lockedAttempts: 0, code: 'EBUSY', ...overrides };
  globalThis.__co30.rmCtl = ctl;
  return ctl;
}
async function withWarnings(fn) {
  const warns = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => { warns.push(parts.map(String).join(' ')); };
  try {
    return { result: await fn(), warns };
  } finally {
    console.warn = originalWarn;
  }
}
const cleanupWarnings = (warns) => warns.filter((line) => line.includes('[clip-insight] ลบโฟลเดอร์ชั่วคราวไม่ได้:'));
const YTDLP_KILLED_MSG = 'yt-dlp โหลดวิดีโอไม่สำเร็จ (ชั่วคราว: timeout 180 วิ) — ลองใหม่ได้ เดี๋ยวก็ผ่าน';

test('F1: yt-dlp ถูกฆ่าแล้ว .part ยังถูกถือ (EBUSY 3 รอบแรก) → rm ลองซ้ำจนลบสำเร็จ ไม่มีโฟลเดอร์ค้าง · options maxRetries≥10 retryDelay≥200 · ลบไม่ได้ถาวร = เตือนใน log ไม่โยน POST ตอบตามปกติ', async () => {
  assert.deepEqual(downloadLeftoversOnDisk(), [], 'ก่อนเริ่มต้องไม่มีโฟลเดอร์ค้างจากข้อสอบอื่น');
  const leftovers = ['video.mp4.part', 'video.f137.mp4.part', 'video.mp4.ytdl'];
  const killed = () => ytDlpError({ code: null, killed: true, signal: 'SIGTERM', stderr: '' });
  try {
    // (1) ถูกถือชั่วครู่ — EBUSY 3 รอบแรกแล้วปลดล็อก (เหมือน Python ลูกปล่อยไฟล์หลัง 2–3 วิ)
    const s1 = freshState({ downloadLeftovers: leftovers, downloadFail: killed });
    const busy = rmControl({ lockedAttempts: 3 });
    const { result: r1, warns: w1 } = await withWarnings(() => postInsight({ url: FB_ONE }));
    assert.equal(r1.status, 422);
    assert.equal(r1.body.retrySafe, true);
    assert.equal(r1.body.error, YTDLP_KILLED_MSG, 'ความพลาดหลักของคำขอต้องไม่ถูกความพลาดตอนลบโฟลเดอร์แทนที่');
    assert.equal(busy.calls.length, 1, 'route เรียก rm ครั้งเดียว — การลองซ้ำเป็นงานของ Node ตาม maxRetries');
    const { path: rmPath, options } = busy.calls[0];
    assert.equal(resolvePath(rmPath), resolvePath(dirname(ytDlpOutPath(s1))), 'ต้องลบโฟลเดอร์ต่อการโหลดของรอบนั้น');
    assert.equal(options.recursive, true, 'maxRetries มีผลเฉพาะ recursive:true');
    assert.equal(options.force, true);
    assert.ok(Number.isInteger(options.maxRetries) && options.maxRetries >= 10, `maxRetries ต้องเป็นจำนวนเต็ม ≥ 10 (ได้ ${options.maxRetries})`);
    assert.ok(Number.isInteger(options.retryDelay) && options.retryDelay >= 200, `retryDelay ต้องเป็นจำนวนเต็ม ≥ 200ms (ได้ ${options.retryDelay})`);
    assert.equal(busy.attempts, 4, 'EBUSY 3 รอบ แล้วรอบที่ 4 ลบสำเร็จ');
    assert.deepEqual(downloadLeftoversOnDisk(), [], 'ลบได้หลังปลดล็อก = ไม่มีโฟลเดอร์ clipdl-* หรือ .part/.ytdl ค้าง');
    assert.deepEqual(cleanupWarnings(w1), [], 'ลบสำเร็จ = ไม่มีคำเตือน');

    // (2) ถูกถือถาวร (ทุกรอบ EBUSY) → เตือนพร้อมรหัส ไม่โยนทับ → 422 ข้อความเดิมของตัวโหลด
    freshState({ downloadLeftovers: leftovers, downloadFail: killed });
    const stuck = rmControl({ lockedAttempts: Infinity });
    const { result: r2, warns: w2 } = await withWarnings(() => postInsight({ url: FB_ONE }));
    assert.equal(r2.status, 422, 'ลบไม่ได้ต้องไม่ทำให้คำขอพังเป็น 500');
    assert.equal(r2.body.success, false);
    assert.equal(r2.body.retrySafe, true);
    assert.equal(r2.body.errorType, 'CLIP_DOWNLOAD_FAILED');
    assert.equal(r2.body.error, YTDLP_KILLED_MSG);
    assert.equal(stuck.attempts, stuck.calls[0].options.maxRetries + 1, 'ลองครบตามเพดานแล้วค่อยยอม');
    assert.equal(cleanupWarnings(w2).length, 1, `ต้องเตือนใน log 1 ครั้ง (ได้ ${JSON.stringify(w2)})`);
    assert.match(cleanupWarnings(w2)[0], /EBUSY/, 'คำเตือนบอกรหัสสาเหตุ');

    // (3) โหลดสำเร็จแต่ลบไม่ได้ถาวร → ถอดสำเร็จตามปกติ (200) + เตือน
    const s3 = freshState({ downloadLeftovers: leftovers });
    rmControl({ lockedAttempts: Infinity });
    const { result: r3, warns: w3 } = await withWarnings(() => postInsight({ url: FB_ONE }));
    assert.equal(r3.status, 200, 'ลบโฟลเดอร์ไม่ได้ต้องไม่ทำให้งานที่ถอดสำเร็จล้ม');
    assert.equal(s3.brain[0].videoBuffer.length, MB);
    assert.equal(cleanupWarnings(w3).length, 1);
  } finally {
    // (2)(3) ตั้งใจให้โฟลเดอร์ค้าง (จำลองลบไม่ได้) — เก็บกวาดเองไม่ให้กระทบข้อสอบอื่น
    for (const name of clipdlDirs()) rmSync(join(tempRoot, name), { recursive: true, force: true });
  }
});

// ═══ รอบ 4 · F3: tikwm — คำ rate/limit ที่ปนในข้อความถาวร ห้ามกลายเป็น "แน่นชั่วคราว" (วนลองซ้ำ 80 รอบ) ═══════════════
test('F3: tikwm ข้อความถาวรที่บังเอิญมี rate/limit (generate · moderated · limited in your region) → ถาวร worker หยุด · จำกัดความถี่จริง (Free Api Limit · Rate limit) → worker ลองใหม่', async () => {
  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const cases = [
    { msg: 'Free Api Limit: 1 request/second.', want: 'retry' },
    { msg: 'Rate limit exceeded', want: 'retry' },
    { msg: 'rate_limit', want: 'retry' },
    { msg: 'Failed to generate play address', want: 'error' },
    { msg: 'Video is under moderated review', want: 'error' },
    { msg: 'This video is limited in your region', want: 'error' },
  ];
  for (const c of cases) {
    const s = freshState();
    globalThis.fetch = tikwmFetch({ api: { code: -1, msg: c.msg }, video: async () => { throw new Error('ไม่มีลิงก์วิดีโอ — ห้ามโหลดไฟล์'); } });
    const insight = await postInsight({ url: TIKTOK_URL });
    assert.equal(insight.status, 422, c.msg);
    assert.equal(insight.body.retrySafe, true, `${c.msg}: ล้มตอนถาม tikwm = ยังไม่จ่ายค่าโมเดล`);
    assert.equal(s.brain.length + s.legacy.length, 0, c.msg);
    const expected = c.want === 'retry'
      ? `tikwm แน่นชั่วคราว (rate limit: ${c.msg})`
      : `tikwm: ไม่พบวิดีโอ (ลิงก์เสีย/โพสต์รูป/ถูกลบ: ${c.msg}) — กดใหม่ไม่ช่วย`;
    assert.equal(insight.body.error, expected, c.msg);
    const run = await runJobAgainst(worker, insight.status, insight.body);
    assert.deepEqual(run.statuses, [c.want], `${c.msg}: worker ต้องรายงาน ${c.want} (ได้ ${run.statuses}) · ข้อความ: ${insight.body.error}`);
  }
});

// ═══ รอบ 4 · F4: คำตัดสินของ route ต้องไม่สวนกับ worker + อาการเน็ตของ Windows/SSL = ชั่วคราว ═══════════════════════
test('F4: yt-dlp — ชื่อคลิปในหัวบรรทัดห้ามหลอก · มีคำถาวรของ worker = ถาวรเสมอ (ห้ามบอก "ลองใหม่ได้") · เน็ต Windows/SSL (WinError 100xx · forcibly closed · IncompleteRead · EOF · RemoteDisconnected) = ลองใหม่', async () => {
  const worker = await settleWithin(loadWorker(), 'โหลด worker ตัวจริงต้องเสร็จ', 5_000);
  const cases = [
    // ถาวร — หัวบรรทัด (ตัวดึง + ชื่อคลิป) ห้ามทำให้เป็นชั่วคราว · มีคำถาวรที่ worker รู้จัก = ถาวร
    { name: 'ชื่อคลิป "timeoutclips" + Unsupported URL', want: 'error', stderr: 'ERROR: [facebook] timeoutclips: Unsupported URL' },
    { name: 'ชื่อคลิป "networknews" + ต้องล็อกอิน (ไม่มีคำถาวรของ worker — หัวบรรทัดต้องไม่พาไปวนซ้ำ 80 รอบ)', want: 'error',
      stderr: 'ERROR: [facebook] networknews: This video is only available for registered users. Use --cookies for the authentication.' },
    { name: 'HTTP Error 502 แต่ fragment not found', want: 'error', stderr: 'HTTP Error 502: Bad Gateway; fragment not found' },
    { name: 'HTTP Error 503 + Video unavailable', want: 'error',
      stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: HTTP Error 503: Service Unavailable; Video unavailable' },
    // ชั่วคราว — อาการเน็ตของ Windows/SSL ที่เคยหลุด whitelist (เดิมได้ "กดใหม่ไม่ช่วย")
    { name: 'WinError 10060 (ข้อความจริงของ Windows)', want: 'retry',
      stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: <urlopen error [WinError 10060] A connection attempt failed because the connected party did not properly respond after a period of time, or established connection failed because connected host has failed to respond>' },
    { name: 'WinError 10060 (รหัสล้วน)', want: 'retry', stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: [WinError 10060]' },
    { name: 'WinError 10051 (เครือข่ายไปไม่ถึง)', want: 'retry', stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: <urlopen error [WinError 10051]>' },
    { name: 'forcibly closed (ไม่มีคำ Connection reset)', want: 'retry',
      stderr: "ERROR: [facebook] 1084395141170409: Unable to download webpage: ConnectionResetError(10054, 'An existing connection was forcibly closed by the remote host', None, 10054, None)" },
    { name: 'IncompleteRead', want: 'retry', stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: IncompleteRead(8192 bytes read, 1024 more expected)' },
    { name: 'EOF occurred in violation of protocol', want: 'retry', stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: EOF occurred in violation of protocol (_ssl.c:1006)' },
    { name: 'SSL UNEXPECTED_EOF_WHILE_READING', want: 'retry', stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: [SSL: UNEXPECTED_EOF_WHILE_READING] (_ssl.c:1006)' },
    { name: 'RemoteDisconnected', want: 'retry', stderr: "ERROR: [facebook] 1084395141170409: Unable to download webpage: RemoteDisconnected('Remote end closed connection without response')" },
  ];
  for (const c of cases) {
    const s = freshState({ downloadFail: () => ytDlpError({ stderr: `${c.stderr}\n` }) });
    const insight = await postInsight({ url: FB_ONE });
    const msg = String(insight.body.error);
    assert.equal(insight.status, 422, c.name);
    assert.equal(insight.body.retrySafe, true, `${c.name}: ล้มตอนโหลด = ยังไม่จ่ายค่าโมเดล`);
    assert.equal(insight.body.errorType, 'CLIP_DOWNLOAD_FAILED', c.name);
    assert.equal(s.downloads, 1, c.name);
    if (c.want === 'error') {
      assert.match(msg, /^yt-dlp โหลดวิดีโอไม่สำเร็จ: .+ — กดใหม่ไม่ช่วย$/, `${c.name}: ถาวรต้องต่อท้าย "กดใหม่ไม่ช่วย" (ได้: ${msg})`);
      assert.doesNotMatch(msg, /ลองใหม่ได้|เดี๋ยวก็ผ่าน|ชั่วคราว/, `${c.name}: ห้ามบอกว่าลองใหม่ได้ ในเคสที่ worker ตัดสินถาวร (ได้: ${msg})`);
    } else {
      assert.match(msg, /^yt-dlp โหลดวิดีโอไม่สำเร็จ \(ชั่วคราว: .+\) — ลองใหม่ได้ เดี๋ยวก็ผ่าน$/, `${c.name}: (ได้: ${msg})`);
    }
    const run = await runJobAgainst(worker, insight.status, insight.body);
    assert.deepEqual(run.statuses, [c.want], `${c.name}: worker ต้องรายงาน ${c.want} (ได้ ${run.statuses}) · ข้อความ: ${msg}`);
  }
  // ข้อความที่แสดงยังมีหัวบรรทัด (คนอ่านรู้ว่าคลิปไหน) · รหัส WinError คงไว้ ไม่ถูกตัดเป็น "…" แบบรหัสวิดีโอ
  freshState({ downloadFail: () => ytDlpError({ stderr: 'ERROR: [facebook] timeoutclips: Unsupported URL\n' }) });
  assert.equal((await postInsight({ url: FB_ONE })).body.error, 'yt-dlp โหลดวิดีโอไม่สำเร็จ: ERROR: [facebook] timeoutclips: Unsupported URL — กดใหม่ไม่ช่วย');
  freshState({ downloadFail: () => ytDlpError({ stderr: 'ERROR: [facebook] 1084395141170409: Unable to download webpage: [WinError 10060]\n' }) });
  assert.equal((await postInsight({ url: FB_ONE })).body.error,
    'yt-dlp โหลดวิดีโอไม่สำเร็จ (ชั่วคราว: ERROR: [facebook] …: Unable to download webpage: [WinError 10060]) — ลองใหม่ได้ เดี๋ยวก็ผ่าน');
});

// ═══ รอบ 4 · F5: ปิดช่องโหว่ถอดลิงก์ห่อ — host เพิ่ม · ถอด u ตามกติกา query · ลบพารามิเตอร์ของตัวห่อหลังแกะแบบไม่เข้ารหัส ═══════
const rowUrlOf = (jobId) => globalThis.__co30Stores.get('clip-jobs').find((j) => j.id === jobId).url;

test('F5 (ก)(ข): ลิงก์ห่อ www./m.facebook.com/l.php และ l.instagram.com → ลิงก์ข้างใน · u ถอดตามกติกา query (%2B = "+" · "+" = ช่องว่าง) · หน้าอื่นที่บังเอิญมี u= ไม่แตะ', () => {
  // (ข) host ตัวห่อที่เพิ่ม — ทั้งแบบเข้ารหัสและไม่เข้ารหัส
  for (const wrapped of [
    `https://www.facebook.com/l.php?u=${encodeURIComponent(TT_SHORT)}&h=AT0abc&__tn__=-UK-R`,
    `https://m.facebook.com/l.php?u=${encodeURIComponent(TT_SHORT)}&h=AT0abc`,
    `https://l.instagram.com/?u=${encodeURIComponent(TT_SHORT)}&e=AT0abc`,
    `https://www.facebook.com/l.php?u=${TT_SHORT}&h=AT0abc`,
    `https://m.facebook.com/l.php?h=AT0abc&u=${TT_SHORT}`,
    `https://l.instagram.com/?u=${TT_SHORT}&e=AT0abc`,
    `ดูอันนี้ https://m.facebook.com/l.php?u=${encodeURIComponent(TT_SHORT)}&h=AT0 นะคะ`,
  ]) assert.equal(extractFirstUrl(wrapped), TT_SHORT, wrapped);
  // (ก) %2B = "+" จริงของลิงก์ข้างใน · "+" ของตัวห่อ = ช่องว่าง (x-www-form-urlencoded) — ช่องว่างท้ายค่าไม่ค้างเป็น "+" ในรหัสวิดีโอ
  assert.equal(extractFirstUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.tiktok.com%2F%40a%2Fvideo%2F1%3Fq%3Da%2Bb&h=AT0'),
    'https://www.tiktok.com/@a/video/1?q=a+b');
  assert.equal(extractFirstUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.facebook.com%2Fwatch%2F%3Fv%3D1084395141170409+&h=AT0'),
    'https://www.facebook.com/watch/?v=1084395141170409', 'regex+decodeURIComponent เดิมได้ "…409+" (รหัสวิดีโอเสีย)');
  // ถอดชั้นละหนึ่งรอบพอดี: ห่อซ้อนห่อ (ค่า u ชั้นในเข้ารหัสซ้ำ) ผสม host ใหม่
  const inner = `https://l.instagram.com/?u=${encodeURIComponent(TT_SHORT)}&e=AT1`;
  assert.equal(extractFirstUrl(`https://www.facebook.com/l.php?u=${encodeURIComponent(inner)}&h=AT0`), TT_SHORT);
  // ไม่ใช่ตัวห่อ = คงเดิมทุกไบต์
  for (const keep of [
    'https://www.facebook.com/watch/?u=https%3A%2F%2Fvt.tiktok.com%2Fx%2F', // www.facebook.com แต่ไม่ใช่พาธ /l.php
    'https://www.facebook.com/l.phpx?u=https%3A%2F%2Fvt.tiktok.com%2Fx%2F', // พาธคล้ายแต่ไม่ใช่
    'https://web.facebook.com/l.php?u=https%3A%2F%2Fvt.tiktok.com%2Fx%2F',  // host นอกรายการ
    'https://www.instagram.com/?u=https%3A%2F%2Fvt.tiktok.com%2Fx%2F',      // instagram หน้าหลัก ไม่ใช่ l.instagram.com
    'https://l.instagram.com/?e=AT0',                                      // ตัวห่อที่ไม่มี u
    'https://l.facebook.com/l.php?u=https%3A%2F%2Fvt.tiktok.com%2FZS%E0%B8&h=AT0', // u ถอดไม่ได้ (UTF-8 ขาดท้าย) = คงลิงก์เดิมเหมือนรอบ 3 (ไม่คืนลิงก์ที่มีอักขระเสีย)
  ]) assert.equal(extractFirstUrl(keep), keep, keep);
});

test('F5 (ค): แกะแบบไม่เข้ารหัสแล้วลิงก์ข้างในมี "?" → พารามิเตอร์ตัวห่อ (h · __tn__ · c[0] · __cft__[0] · s · e) ถูกลบ ของลิงก์จริงคงไว้ · ลิงก์ตรงที่มีชื่อเดียวกันไม่ถูกแตะ · ผ่านคิวกันซ้ำกับลิงก์ตรง', async () => {
  const direct = 'https://www.tiktok.com/@a/video/7351234567890123456?is_from_webapp=1&sender_device=pc';
  const tail = '&h=AT0abc&__tn__=-UK-R&c[0]=AT1xyz&__cft__[0]=AZXq&s=1&e=AT2';
  assert.equal(extractFirstUrl(`https://l.facebook.com/l.php?u=${direct}${tail}`), direct);
  assert.equal(extractFirstUrl(`https://www.facebook.com/l.php?u=${direct}&h=AT0abc`), direct);
  assert.equal(extractFirstUrl(`https://l.instagram.com/?u=${direct}&e=AT0abc`), direct);
  assert.equal(extractFirstUrl(`ดูนี่ (https://l.messenger.com/l.php?u=${direct}&h=AT0&__cft__[0]=AZX).`), direct);
  // ชื่อพารามิเตอร์แบบเข้ารหัส (%5B0%5D) ก็ลบได้ — URLSearchParams ถอดชื่อให้
  assert.equal(extractFirstUrl(`https://l.facebook.com/l.php?u=${direct}&c%5B0%5D=AT1&__cft__%5B0%5D=AZX`), direct);
  // ลิงก์ตรง (ไม่ได้แกะจากตัวห่อ) ที่มีพารามิเตอร์ชื่อเดียวกันของตัวเอง — ห้ามแตะ
  for (const own of ['https://www.tiktok.com/@a/video/1?h=own&s=2&e=3', 'https://www.facebook.com/watch/?v=1084395141170409&s=1', `${direct}&h=AT0`]) {
    assert.equal(extractFirstUrl(own), own, own);
  }
  // ปลายทางคิว: ลิงก์ห่อไม่เข้ารหัส (พารามิเตอร์ตัวห่อติดท้าย) กับลิงก์ตรง = ใบเดียวกัน
  const job = await submitClipJob({ url: `https://l.facebook.com/l.php?u=${direct}${tail}`, user: 'ทดสอบ' });
  assert.equal(job.dup, false);
  assert.equal(job.platform, 'tiktok');
  assert.equal(rowUrlOf(job.jobId), cleanClipUrl(direct), 'job.url = ลิงก์จริงไม่มีพารามิเตอร์ตัวห่อ');
  const again = await submitClipJob({ url: direct });
  assert.equal(again.dup, true, 'ลิงก์ห่อกับลิงก์ตรงต้องชนใบเดิม');
  assert.equal(again.jobId, job.jobId);
});

// ═══ รอบ 4 · F6: เอเจนต์ค้นผลด้วยลิงก์เดิมที่ส่งไป (ซ้อน/ห่อ/มีข้อความปน) ต้องเจอใบที่คลังเก็บเป็นลิงก์ล้างแล้ว ═══════════════
const AGENT_KEY = 'co30-agent-key';
async function getAgentResult(query) {
  const res = await settleWithin(resultRoute.GET(new Request(`http://localhost/api/clip-agent/result?${query}`, {
    headers: { 'x-clip-agent-key': AGENT_KEY },
  })), 'GET /api/clip-agent/result ต้องตอบกลับ', 5_000);
  return { status: res.status, body: await res.json() };
}

test('F6: /api/clip-agent/result?url= — คลังเก็บลิงก์ล้างแล้ว · ค้นด้วยลิงก์ซ้อน 2 รอบ/ลิงก์ห่อ/มีข้อความปน → เจอใบเดิม (insight และ transcript) · ลิงก์ที่ไม่มีในคลังยัง 404', async () => {
  process.env.CLIP_AGENT_API_KEY = AGENT_KEY;
  // เก็บแบบเดียวกับที่คิว/route ถอดเก็บจริง: record.url = cleanClipUrl(extractFirstUrl(ลิงก์ที่วาง))
  const encodedWrap = `https://l.facebook.com/l.php?u=${encodeURIComponent(`${TT_SHORT}?fbclid=IwAR0xyz`)}&h=AT0abc`;
  const stored = { fb: cleanClipUrl(extractFirstUrl(FB_TWICE)), tt: cleanClipUrl(extractFirstUrl(encodedWrap)) };
  assert.deepEqual(stored, { fb: FB_ONE, tt: TT_SHORT }, 'คลังเก็บลิงก์ล้างแล้ว');
  const row = (id, url, platform) => ({
    id, url, platform, title: `ข่าวทดสอบ ${id}`, createdAt: '2026-09-30T08:05:00.000Z', insight: { headline: `พาดหัว ${id}`, overview: 'เนื้อทดสอบ' },
  });
  globalThis.__co30Stores.set('clip-insights', [row('co30-fb', stored.fb, 'meta'), row('co30-tt', stored.tt, 'tiktok')]);
  globalThis.__co30Stores.set('clip-transcripts', [{ id: 'co30-fb-tr', url: stored.fb, platform: 'meta', caption: 'คำบรรยาย', rawText: 'ต้นฉบับ', createdAt: '2026-09-30T08:05:00.000Z' }]);
  const queries = [
    [FB_TWICE, 'co30-fb', 'ลิงก์ซ้อน 2 รอบ (ใบงาน 15:04)'],
    [`${FB_ONE}?fbclid=AbC${FB_ONE}?fbclid=AbC`, 'co30-fb', 'ลิงก์ซ้อน + fbclid'],
    [`ดูคลิปนี้ ${FB_ONE} นะคะ`, 'co30-fb', 'มีข้อความปน'],
    [encodedWrap, 'co30-tt', 'ลิงก์ห่อเข้ารหัส + fbclid ข้างใน'],
    [`https://www.facebook.com/l.php?u=${TT_SHORT}&h=AT0`, 'co30-tt', 'ลิงก์ห่อไม่เข้ารหัส www.facebook.com/l.php'],
    [`https://l.instagram.com/?u=${encodeURIComponent(TT_SHORT)}&e=AT0`, 'co30-tt', 'ลิงก์ห่อ l.instagram.com'],
    [FB_ONE, 'co30-fb', 'ลิงก์ตรง (เดิมก็เจอ)'],
  ];
  for (const [q, wantId, why] of queries) {
    const { status, body } = await getAgentResult(`url=${encodeURIComponent(q)}`);
    assert.equal(status, 200, `${why}: ต้องเจอ (ได้ ${status} ${JSON.stringify(body)})`);
    assert.equal(body.ok, true, why);
    assert.equal(body.result.caseId, wantId, why);
  }
  const transcript = await getAgentResult(`kind=transcript&url=${encodeURIComponent(FB_TWICE)}`);
  assert.equal(transcript.status, 200);
  assert.equal(transcript.body.result.caseId, 'co30-fb-tr', 'kind=transcript ใช้กติกาเดียวกัน');
  for (const q of ['https://www.facebook.com/pepedog89/videos/999', `https://l.facebook.com/l.php?u=${encodeURIComponent('https://vt.tiktok.com/ZSother/')}`, 'ไม่มีลิงก์เลย']) {
    const miss = await getAgentResult(`url=${encodeURIComponent(q)}`);
    assert.equal(miss.status, 404, q);
    assert.deepEqual(miss.body, { ok: false, errorType: 'CASE_NOT_FOUND' }, q);
  }
});
