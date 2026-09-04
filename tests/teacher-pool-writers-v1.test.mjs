// ★ 4 ก.ย. 69 (WF5 ครู writers-v1) — สวิตช์ TEACHER_POOL / TEACHER_POOL_FILE ใน src/lib/services/viralFewshot.js
//   รัน: node --test tests/teacher-pool-writers-v1.test.mjs (ไม่ต้องตั้ง env · ไม่แตะ Supabase จริง · ไม่เขียนไฟล์ในโปรเจกต์)
//   สนามจำลอง (แบบแผน tests/teacher-rank-v2.test.mjs ข้อ 13): PostgREST จำลอง http บน 127.0.0.1 พอร์ต 0 ในแม่ + spawn ลูกแบบ async
//   ลูกโหลดโมดูลที่แม่ชี้ (worktree หรือสำเนา HEAD จาก git show — เขียนลงโฟลเดอร์เดียวกับต้นฉบับให้ import สัมพัทธ์ทำงาน แล้วลบทิ้ง)
//   Math.random ถูกแทนด้วยตัวสุ่ม seed เดียวกันก่อน import (weightedSample + rank-v2 rotate) · ลูกเรียก getViralFewshotBlock จริง พิมพ์ผล JSON
//
//   ชุด ก พาริตี้ HEAD (fuzz): ไม่ตั้ง TEACHER_POOL/TEACHER_POOL_FILE = บล็อก · ลำดับ+URL คำขอ · log ทั้งหมด · body ที่ POST สมุดประวัติ ต้องเท่า HEAD เป๊ะ
//   ชุด ข TEACHER_POOL=writers-v1 · ชุด ค TEACHER_POOL_FILE (ห้องแล็บ)
//
// ผลการทุบโค้ด (mutation) — ทุบ src/lib/services/viralFewshot.js จริงทีละจุดแล้วคืนไบต์เดิม (md5 bd59b921… ก่อน/หลังตรงทุกรอบ · ยิงจริง 4 ก.ย. 69 · 34 ข้อ):
//   M1 ตัดการกรอง tags (rows = rows.filter((r) => _rowInPool(r, poolTag)) → ไม่กรอง)          ⇒ แดง 6: ข1 ข2 ข3 ข4 ข5 ข6 (ครูไม่มีป้ายหลุดเข้าบล็อก · ตารางไม่มีแถวป้ายแต่ยังได้ครู)
//   M2 ตัด cacheKey พูล (_poolCacheKey คืน baseKey เสมอ)                                      ⇒ แดง: ข6 (เปิด→ปิดในโปรเซสเดียวกินแคชผิดก้อน — GET ถึง mock 1 ครั้งแทน 2)
//      (รอบทุบครั้งแรก ก14 แดงร่วมด้วย 1 ครั้ง — รันซ้ำ 3 รอบไม่เกิดอีก · โค้ดเส้นปิดไม่แตะ cacheKey จึงสงสัยสนามจำลองใต้โหลด ตามหมายเหตุ teacher-rank-v2 บรรทัด 41)
//   M3 ถอยไปพูลเดิมเมื่อกรองป้ายแล้วว่าง (rows = _f.length ? _f : rows)                          ⇒ แดง: ข4 (ครูเดิมหลุดมา + ไม่มี log พูลว่าง)
//   M4 ตัด Vercel guard ใน _poolFileActive (if (false))                                         ⇒ แดง: ค5 (VERCEL=1 แล้วยังอ่านไฟล์ · ไม่มี console.error · ไม่ยิง viral_examples)
//   M5 ตัดการข้ามสมุดประวัติใน _recordPickHistory                                               ⇒ แดง: ค1-4 ค7 (มี POST viral_pick_history + ไม่มี log ข้าม)
//   M6 ตัด merge ไลก์จากไฟล์พูล (_likesMapForPick/_likesByIdForRank คืน byId ของ data/ อย่างเดียว)   ⇒ แดง: ค1-4 (ไม่มี log 💗 ไลก์จริง 6/6 · rank-v2 ไม่หยิบ 2 ใบไลก์สูงสุดตามไฟล์)
//   M7 (แถม) ตัด || poolCross ออกจาก crossCat                                                  ⇒ แดง: ข3 (หัวบล็อกประกาศหมวด C ที่พูลไม่มี)
//   — รอบแก้ตามผู้ตรวจไขว้ (4 ก.ย. 69 · 39 ข้อ · md5 หลังแก้ ded3470b… ก่อน/หลังทุบตรงทุกรอบ) —
//   M8 ตัดยกเว้นค่าปิดสามัญ (POOL_OFF_RE) ใน _teacherPool                                      ⇒ แดง: ก19 ก20 (TEACHER_POOL=off/0 พิมพ์ "อ่านไม่ออก" เกิน HEAD)
//   M9 ตัดกรองหมวดฝั่ง client โหมดไม่กว้าง (if (!wide) → if (false))                             ⇒ แดง: ข2 ข2ข ข3 ค9 (top2 ได้ FILL_1 แทน A · หัวบล็อกประกาศหมวดที่พูล/ไฟล์ไม่มี)
//   M10 ตัด fail() เมื่อไฟล์แล็บไม่เหลือใบใช้ได้ (ไม่มี id / เนื้อสั้นหมด)                            ⇒ แดง: ค6 (เคส no-id / all-short ไม่ error · ประกาศ 0 ใบ)
//   ชุด ก (พาริตี้) ไม่แดงในทุก mutation = ถูกต้อง: ทุกจุดที่ทุบอยู่หลังสวิตช์ เส้นปิดไม่เปลี่ยน — ชุด ก จะแดงเมื่อใครแตะบรรทัดเดิม (เช่น สตริง select/log)
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const SRC_REL = 'src/lib/services/viralFewshot.js';
const SRC_PATH = join(ROOT, SRC_REL);

// ── โหมดโปรเซสลูก: โหลดโมดูลตาม POOL_FIELD_MODULE · seed ตาม POOL_FIELD_SEED · รับ { calls: [{ brief, env }] } ทาง stdin ──
//   ทำไมต้องแยกโปรเซสต่อฉาก: viralFewshot แคชคลังครู 10 นาที/สมุด 5 นาที/ไคลเอนต์ Supabase ระดับโมดูล
//   บล็อกนี้อยู่ก่อน test() ทุกข้อ → ลูกไม่ลงทะเบียนข้อสอบ
if (process.env.POOL_FIELD_CHILD === '1') {
  let s = Number(process.env.POOL_FIELD_SEED) || 7;
  Math.random = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const orig = { log: console.log, warn: console.warn, error: console.error };
  let logs = [];
  console.log = (...a) => { logs.push('log ' + a.map(String).join(' ')); };
  console.warn = (...a) => { logs.push('warn ' + a.map(String).join(' ')); };
  console.error = (...a) => { logs.push('error ' + a.map(String).join(' ')); };
  const results = [];
  let fatal = null;
  try {
    const mod = await import(pathToFileURL(process.env.POOL_FIELD_MODULE).href);
    const input = JSON.parse(readFileSync(0, 'utf8'));
    for (const call of input.calls) {
      for (const [k, v] of Object.entries(call.env || {})) { if (v === null) delete process.env[k]; else process.env[k] = v; }
      logs = [];
      let block = '', err = null;
      try { block = await mod.getViralFewshotBlock(call.brief); } catch (e) { err = String(e?.stack || e?.message || e); }
      results.push({ block, logs, err });
    }
  } catch (e) { fatal = String(e?.stack || e?.message || e); }
  Object.assign(console, orig);
  process.stdout.write(`\n__POOL_FIELD_JSON__${JSON.stringify({ results, fatal })}\n`, () => process.exit(0));
  await new Promise(() => {});
}

// ── สำเนา HEAD ของ viralFewshot.js — เขียนข้างต้นฉบับ (import สัมพัทธ์ ../supabase.js ./teacherRank.js ทำงาน) · ลบทิ้งแม้เทสล้ม ──
const HEAD_PATH = join(ROOT, 'src', 'lib', 'services', `viralFewshot.head-parity-${process.pid}-${Date.now().toString(36)}.tmp.js`);
const cleanupHead = () => { try { if (existsSync(HEAD_PATH)) unlinkSync(HEAD_PATH); } catch { /* ignore */ } };
writeFileSync(HEAD_PATH, execFileSync('git', ['-C', ROOT, 'show', `HEAD:${SRC_REL}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
process.on('exit', cleanupHead);
after(cleanupHead);

// ── ฟิกซ์เจอร์: ตารางจำลอง 40 แถว (tags [] ปนกับ tags ['igdara-writers-v1']) + บัตร/ไลก์ปลอมใน tmpdir ──
const POOL_TAG = 'igdara-writers-v1';
const uuidOf = (seed) => {
  const h = createHash('sha256').update(`pool-test:${seed}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const BRIEF_A = { category: 'ช่วยเหลือกัน', emotionalTags: ['ซาบซึ้ง', 'น้ำใจ'], archetype: 'น้ำใจคนแปลกหน้า',
  newsTitle: 'ชาวบ้านร่วมใจช่วยเหลือครอบครัวผู้สูญเสีย', newsBrief: { coreStory: 'เปิดด้วยเหตุสูญเสีย เล่าการช่วยเหลือของพระสงฆ์และชุมชน จบด้วยน้ำใจ', excerpt: 'พระสงฆ์ ตำรวจ และชาวบ้านช่วยเหลือครอบครัวที่สูญเสีย ด้วยน้ำใจ' } };
const BRIEF_B = { category: 'การเมือง', emotionalTags: ['โกรธ', 'ผิดหวัง'], archetype: 'ข่าวการเมือง',
  newsTitle: 'ศึกอภิปรายงบประมาณเดือด', newsBrief: { coreStory: 'ฝ่ายค้านซัดรัฐบาลเรื่องงบ', excerpt: 'อภิปรายงบประมาณกลางสภา' } };
const BRIEF_C = { category: 'กีฬา', emotionalTags: ['ภูมิใจ', 'ตื่นเต้น'], archetype: 'นักกีฬาทีมชาติ',
  newsTitle: 'นักวอลเลย์บอลทีมชาติคว้าเหรียญทอง', newsBrief: { coreStory: 'จากเด็กบ้านนอกสู่เหรียญทอง', excerpt: 'ทีมชาติไทยชนะ 3-0' } };
const BRIEF_N = { category: 'สังคม', emotionalTags: ['ซาบซึ้ง', 'สะเทือนใจ', 'ชื่นชม'], archetype: 'เรื่องราวของคนคนหนึ่ง',
  newsTitle: 'เรื่องราวของคนคนหนึ่งที่ไม่มีชั้นตรง', newsBrief: { coreStory: 'เล่าชีวิตคนคนหนึ่ง', excerpt: 'เรื่องราวชีวิต' } };
const CAT_A = 'ช่วยเหลือกัน', CAT_B = 'ข่าวการเมือง', CAT_C = 'ข่าวกีฬา', FILL_1 = 'สู้ชีวิต', FILL_2 = 'ดราม่าครอบครัว';
const THEMES_FULL = ['ช่วยเหลือ', 'น้ำใจ', 'สูญเสีย', 'พระสงฆ์'], THEMES_LITE = ['ช่วยเหลือ'];
const ess = (themes, i) => ({ emotion: ['ซาบซึ้ง', 'สะเทือนใจ'], structure: `เปิดด้วยเหตุสูญเสีย เล่าการช่วยเหลือ จบด้วยน้ำใจ ${i}`, themes, tone: 'อบอุ่น' });
// [หมวด, ป้าย?, ไลก์จริง(ไฟล์), บัตร] × 40 — ป้าย 18 ใบ (CAT_A 10 · FILL_1 4 · FILL_2 4) · ไม่มีป้าย 22 ใบ (CAT_A 10 · FILL_1 6 · CAT_C 6) · CAT_B ไม่มีแถวเลย
const SPEC = [];
for (let i = 0; i < 10; i++) SPEC.push([CAT_A, true, 60000 + i * 10000 + (i >= 8 ? 100000 : 0), i >= 8 ? THEMES_FULL : THEMES_LITE]); // 2 ใบท้าย = ไลก์สูงสุด + บัตรตรงสุด
for (let i = 0; i < 10; i++) SPEC.push([CAT_A, false, i % 3 === 0 ? 0 : 40000 + i * 5000, i % 2 ? THEMES_FULL : THEMES_LITE]);
for (let i = 0; i < 4; i++) SPEC.push([FILL_1, true, 50000 + i * 3000, THEMES_LITE]);
for (let i = 0; i < 6; i++) SPEC.push([FILL_1, false, i % 2 ? 0 : 55000 + i * 2000, THEMES_LITE]);
for (let i = 0; i < 4; i++) SPEC.push([FILL_2, true, 45000 + i * 4000, THEMES_LITE]);
for (let i = 0; i < 6; i++) SPEC.push([CAT_C, false, 70000 + i * 1000, THEMES_LITE]);
const ROWS = SPEC.map(([category, tagged, likes, themes], i) => ({
  id: uuidOf(i), category, tagged, likes, themes,
  title: `ครูสนาม${i}`, content: `เนื้อครู-${uuidOf(i).slice(0, 8)} ${tagged ? 'ป้าย' : 'ไม่ป้าย'} ` + 'ก'.repeat(260),
  writing_notes: `โน้ตสนาม ${i}`, engagement_likes: 0, tags: tagged ? [POOL_TAG, 'author:สนาม', 'tier:senior'] : [],
}));
const TABLE = ROWS.map(({ id, title, content, writing_notes, category, engagement_likes, tags }) => ({ id, title, content, writing_notes, category, engagement_likes, tags }));
const TABLE_UNTAGGED = TABLE.filter((r) => !r.tags.length).map((r) => ({ ...r, tags: [] }));
const marker = (r) => `เนื้อครู-${String(r.id).slice(0, 8)}`;
const teachersInBlock = (block, rows = ROWS) => rows.filter((r) => block.includes(marker(r)));
const blockHasExamples = (block) => /--- ตัวอย่าง 1 ---/.test(block);

// cwd ของลูก: tmpdir ที่มี data/viral-likes-real.json + data/viral-essences.json ปลอม (โค้ดอ่าน path.join(process.cwd(), 'data', …))
const TMP = mkdtempSync(join(tmpdir(), 'teacher-pool-writers-v1-'));
after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });
const CWD_FAKE = join(TMP, 'cwd-fake'), CWD_EMPTY = join(TMP, 'cwd-empty');
mkdirSync(join(CWD_FAKE, 'data'), { recursive: true });
mkdirSync(join(CWD_EMPTY, 'data'), { recursive: true });
writeFileSync(join(CWD_FAKE, 'data', 'viral-likes-real.json'), JSON.stringify({
  byId: Object.fromEntries(ROWS.filter((r) => r.likes > 0).map((r) => [r.id, { likes: r.likes, matchedBy: 'test' }])), byKey: {},
}));
writeFileSync(join(CWD_FAKE, 'data', 'viral-essences.json'), JSON.stringify(Object.fromEntries(ROWS.map((r, i) => [r.id, ess(r.themes, i)]))));

// ── PostgREST จำลอง: ตอบ viral_examples ตาม select/category=eq./limit ของ URL จริง (คอลัมน์ที่ไม่ได้ขอ = ไม่ส่ง — เหมือน PostgREST) ──
async function withMockDb({ rows = TABLE, usageRows = [], viralStatus = 0 } = {}, fn) {
  const st = { requests: [], inserted: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://127.0.0.1');
      const select = u.searchParams.get('select') || '';
      st.requests.push({ m: req.method, path: u.pathname, select, url: req.url });
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'content-range': '0-0/*' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'GET' && u.pathname === '/rest/v1/viral_examples') {
        if (viralStatus) return json(viralStatus, { message: 'boom-mock', code: 'XX000', details: null, hint: null }); // ชุด X: PostgREST ล้ม
        const cols = select.split(',').map((x) => x.trim()).filter(Boolean);
        let out = rows;
        const cat = u.searchParams.get('category');
        if (cat && cat.startsWith('eq.')) out = out.filter((r) => r.category === cat.slice(3));
        const lim = Number(u.searchParams.get('limit'));
        if (lim > 0) out = out.slice(0, lim);
        return json(200, out.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]]))));
      }
      if (req.method === 'GET' && u.pathname === '/rest/v1/store_items') {
        if (select === 'data->picks') return json(200, usageRows.map((r) => ({ picks: r.picks })));
        return json(200, usageRows.map(() => ({})));
      }
      if (req.method === 'POST' && u.pathname === '/rest/v1/store_items') { try { st.inserted.push(JSON.parse(body)); } catch { st.inserted.push({ raw: body }); } return json(201, undefined); }
      return json(404, []);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn({ port: server.address().port, st }); }
  finally { await new Promise((r) => server.close(r)); }
}

// ── ยิงโปรเซสลูก (env ล้างของ Supabase/สวิตช์ครู/แล็บ/Vercel ออกก่อน — เชลล์คนรันอาจ export .env.local ไว้) ──
const CLEAN_RE = /^(NODE_TEST|SUPABASE|NEXT_PUBLIC_SUPABASE|VIRAL_|TEACHER_|LIB_CLASSIFIER|CARD_TEACHER|CARD_LIBRARY|VERCEL|POOL_FIELD)/;
function runChild({ port, module = SRC_PATH, cwd = CWD_FAKE, env: envOverride = {}, calls, seed = 7 }) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (CLEAN_RE.test(k)) delete env[k];
  Object.assign(env, {
    POOL_FIELD_CHILD: '1', POOL_FIELD_MODULE: module, POOL_FIELD_SEED: String(seed),
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_KEY: 'fake-key-for-mock-only', SUPABASE_RESILIENCE_MODE: 'off',
  });
  for (const [k, v] of Object.entries(envOverride)) { if (v === null || v === undefined) delete env[k]; else env[k] = String(v); }
  return new Promise((resolve, reject) => {
    const ch = spawn(process.execPath, ['--no-warnings', SELF], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }); // --no-warnings: กัน MODULE_TYPELESS_PACKAGE_JSON (มีชื่อไฟล์/pid) ปนใน log ที่เทียบพาริตี้
    let stdout = '', stderr = '';
    ch.stdout.setEncoding('utf8'); ch.stderr.setEncoding('utf8');
    ch.stdout.on('data', (c) => { stdout += c; });
    ch.stderr.on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => { ch.kill(); reject(new Error(`โปรเซสลูกค้างเกิน 60 วิ · stderr: ${stderr.slice(-800)}`)); }, 60000);
    ch.on('error', (e) => { clearTimeout(timer); reject(e); });
    ch.on('close', (code) => {
      clearTimeout(timer);
      try {
        const m = stdout.match(/__POOL_FIELD_JSON__(\{.*\})/su);
        assert.ok(m, `โปรเซสลูกไม่คืนผล (exit ${code}) stderr: ${stderr.slice(-800)}`);
        const out = JSON.parse(m[1]);
        assert.equal(out.fatal, null, `ลูกล้มก่อนเรียก: ${out.fatal}`);
        resolve(out.results);
      } catch (e) { reject(e); }
    });
    ch.stdin.end(JSON.stringify({ calls }));
  });
}
const runOne = async (opts) => (await runChild({ ...opts, calls: [{ brief: opts.brief, env: opts.callEnv || {} }] }))[0];
const getsViral = (st) => st.requests.filter((r) => r.m === 'GET' && r.path === '/rest/v1/viral_examples');
const postsHistory = (st) => st.requests.filter((r) => r.m === 'POST' && r.path === '/rest/v1/store_items');
const rankPickIds = (logs) => { const l = logs.find((x) => x.includes('rank-v2 หยิบ')); const m = l && l.match(/rank-v2 หยิบ ([0-9a-f]{8})\+([0-9a-f]{8})/); return m ? [m[1], m[2]] : null; };

// ── normalize ของที่ต่างกันโดยธรรมชาติข้ามโปรเซส (เวลา/รหัสสุ่มของแถวสมุด) ก่อนเทียบพาริตี้ ──
const normTs = (s) => String(s)
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ts>')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A\d{2}(\.\d+)?Z/g, '<ts>')
  .replace(/vpick_\d+_[a-z0-9]+/g, 'vpick_<id>')
  .replace(/\d+(\.\d+)? ?ms\b/g, '<ms>');
const normReq = (st) => st.requests.map((r) => `${r.m} ${normTs(decodeURIComponent(r.url))}`);
const normInserted = (st) => st.inserted.map((b) => normTs(JSON.stringify(b)));
// ซ็อกเก็ตท้องถิ่นสะดุด (fetch failed ไปหา mock 127.0.0.1 — เครื่องโหลด/พอร์ตชั่วคราว) = เรื่องของเครื่อง ไม่ใช่โค้ด → ลองซ้ำได้อีก 2 ครั้งก่อนตัดสินพาริตี้
const FETCH_FAIL_RE = /TypeError: fetch failed/;
async function stable(run) {
  let out;
  for (let k = 0; k < 3; k++) {
    out = await run();
    const rs = Array.isArray(out.r) ? out.r : [out.r];
    if (!rs.some((x) => (x.logs || []).some((l) => FETCH_FAIL_RE.test(l)) || FETCH_FAIL_RE.test(String(x.err || '')))) break;
  }
  return out;
}

// ═══ ฟิกซ์เจอร์ต้องกัดได้จริง ═══
test('0 ฟิกซ์เจอร์: 40 แถว · ป้าย 18/ไม่ป้าย 22 · หมวดข่าว A/B/C ตามตัวจำแนก V2 (A มีทั้งสองแบบ · B ไม่มีแถว · C ไม่มีป้าย) · ข่าว N ไม่มีชั้นตรง', async () => {
  const mod = await import(pathToFileURL(SRC_PATH).href);
  assert.equal(TABLE.length, 40);
  assert.equal(TABLE.filter((r) => r.tags.includes(POOL_TAG)).length, 18);
  assert.equal(mod.pickLibraryCategoryV2(BRIEF_A), CAT_A);
  assert.equal(mod.pickLibraryCategoryV2(BRIEF_B), CAT_B);
  assert.equal(mod.pickLibraryCategoryV2(BRIEF_C), CAT_C);
  assert.equal(mod.pickLibraryCategoryV2(BRIEF_N), null);
  assert.ok(ROWS.some((r) => r.category === CAT_A && r.tagged) && ROWS.some((r) => r.category === CAT_A && !r.tagged));
  assert.equal(ROWS.filter((r) => r.category === CAT_B).length, 0);
  assert.ok(ROWS.filter((r) => r.category === CAT_C).length > 0 && ROWS.every((r) => r.category !== CAT_C || !r.tagged));
  assert.ok(TABLE.every((r) => r.content.length > 200));
  assert.ok(existsSync(HEAD_PATH), 'สำเนา HEAD ต้องถูกเขียนไว้ข้างต้นฉบับ');
});

// ═══ ชุด ก — พาริตี้ HEAD (fuzz): ไม่ตั้ง TEACHER_POOL/TEACHER_POOL_FILE = ทุกอย่างเท่า HEAD เป๊ะ ═══
//   ครอบทุกค่า: VIRAL_SHORTLIST {unset,1} × VIRAL_ROTATE {unset,0} × TEACHER_RANK_V2 {unset,0} × VIRAL_MATCH_MODE {unset,score} × LIB_CLASSIFIER_V2 {unset,0}
//   + ข่าว 4 แบบ (A มีชั้น · B ชั้นว่าง · C · N ไม่มีชั้นตรง) + TEACHER_POOL='' + TEACHER_POOL_FILE ตั้งแต่ LAB ไม่ตั้ง + TEACHER_POOL=writers-v9
test('0ข กันชน env: เชลล์คนรันมีกุญแจ Supabase จริง/SUPABASE_DISABLED ค้าง → โปรเซสลูกเห็นแต่ PostgREST จำลอง (ไม่ยิง DB จริง · ไม่ถูกปิด)', async () => {
  const leaked = { NEXT_PUBLIC_SUPABASE_URL: 'https://real-project.supabase.co', SUPABASE_URL: 'https://real-project.supabase.co', SUPABASE_SERVICE_KEY: 'real-key', SUPABASE_SERVICE_ROLE_KEY: 'real-key', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'real-anon', SUPABASE_DISABLED: '1', SUPABASE_RESILIENCE_MODE: 'team', VIRAL_SHORTLIST: '0' };
  const saved = Object.fromEntries(Object.keys(leaked).map((k) => [k, process.env[k]]));
  Object.assign(process.env, leaked);
  try {
    await withMockDb({}, async ({ port, st }) => {
      const t0 = Date.now();
      const r = await runOne({ port, brief: BRIEF_A, env: { VIRAL_SHORTLIST: '1' } });
      assert.equal(r.err, null, r.err);
      assert.ok(getsViral(st).length >= 1, 'ต้องมี GET viral_examples ถึง mock (env จริงถูกล้างก่อน spawn)');
      assert.ok(blockHasExamples(r.block), 'ต้องได้ครูจาก mock (ไม่ใช่ถูก SUPABASE_DISABLED ปิด)');
      assert.ok(Date.now() - t0 < 10000, 'ต้องจบเร็ว (ถ้าช้า = หลุดไปยิง DB จริง/รอ timeout)');
    });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

const U = null;
const FUZZ = [
  { name: 'ค่าเริ่มต้นล้วน · A', env: {}, brief: BRIEF_A },
  { name: 'ค่าเริ่มต้นล้วน · B (ชั้นว่าง)', env: {}, brief: BRIEF_B },
  { name: 'ค่าเริ่มต้นล้วน · N (ไม่มีชั้นตรง)', env: {}, brief: BRIEF_N },
  { name: 'SHORTLIST=1 · A', env: { VIRAL_SHORTLIST: '1' }, brief: BRIEF_A },
  { name: 'SHORTLIST=1 · B (ชั้นว่าง → ข้ามหมวด)', env: { VIRAL_SHORTLIST: '1' }, brief: BRIEF_B },
  { name: 'SHORTLIST=1 · C', env: { VIRAL_SHORTLIST: '1' }, brief: BRIEF_C },
  { name: 'SHORTLIST=1 + RANK_V2=0 · A', env: { VIRAL_SHORTLIST: '1', TEACHER_RANK_V2: '0' }, brief: BRIEF_A },
  { name: 'SHORTLIST=1 + ROTATE=0 (เกราะ 5) · A', env: { VIRAL_SHORTLIST: '1', VIRAL_ROTATE: '0' }, brief: BRIEF_A },
  { name: 'ROTATE=0 (top2) · A', env: { VIRAL_ROTATE: '0' }, brief: BRIEF_A },
  { name: 'ROTATE=0 · C', env: { VIRAL_ROTATE: '0' }, brief: BRIEF_C },
  { name: 'MATCH_MODE=score · A', env: { VIRAL_MATCH_MODE: 'score' }, brief: BRIEF_A },
  { name: 'MATCH_MODE=score + SHORTLIST=1 (เกราะ 4) · B', env: { VIRAL_MATCH_MODE: 'score', VIRAL_SHORTLIST: '1' }, brief: BRIEF_B },
  { name: 'LIB_CLASSIFIER_V2=0 · N (ตัวจำแนกเดิม)', env: { LIB_CLASSIFIER_V2: '0' }, brief: BRIEF_N },
  { name: 'LIB_CLASSIFIER_V2=0 + SHORTLIST=1 · A', env: { LIB_CLASSIFIER_V2: '0', VIRAL_SHORTLIST: '1' }, brief: BRIEF_A },
  { name: 'SHORTLIST=1 + RANK_V2=0 + LIB_CLASSIFIER_V2=0 · C', env: { VIRAL_SHORTLIST: '1', TEACHER_RANK_V2: '0', LIB_CLASSIFIER_V2: '0' }, brief: BRIEF_C },
  { name: 'ทุกสวิตช์ปิด/เก่า: ROTATE=0 + RANK_V2=0 + LIB_CLASSIFIER_V2=0 · A', env: { VIRAL_ROTATE: '0', TEACHER_RANK_V2: '0', LIB_CLASSIFIER_V2: '0' }, brief: BRIEF_A },
  { name: 'TEACHER_POOL="" (ว่าง) + SHORTLIST=1 · A', env: { VIRAL_SHORTLIST: '1', TEACHER_POOL: '' }, brief: BRIEF_A },
  { name: 'TEACHER_POOL="" · C (rotate)', env: { TEACHER_POOL: '' }, brief: BRIEF_C },
  { name: 'TEACHER_POOL=off (ค่าปิดสามัญ) + SHORTLIST=1 · A = เส้นเดิม ไม่มี log เพิ่ม', env: { VIRAL_SHORTLIST: '1', TEACHER_POOL: 'off' }, brief: BRIEF_A },
  { name: 'TEACHER_POOL=0 (ค่าปิดสามัญ) · C rotate = เส้นเดิม ไม่มี log เพิ่ม', env: { TEACHER_POOL: '0' }, brief: BRIEF_C },
  { name: 'TEACHER_POOL=writers-v9 (อ่านไม่ออก) + SHORTLIST=1 · A = เส้นเดิม + log 1 บรรทัด', env: { VIRAL_SHORTLIST: '1', TEACHER_POOL: 'writers-v9' }, brief: BRIEF_A,
    allowExtra: /^log \[ViralFewshot\] 🧑‍🏫 TEACHER_POOL="writers-v9" อ่านไม่ออก/ },
  { name: 'TEACHER_POOL_FILE ตั้งแต่ CARD_LIBRARY_LAB ไม่ตั้ง + SHORTLIST=1 · A = เส้นเดิม + log เพิกเฉย 1 บรรทัด', env: { VIRAL_SHORTLIST: '1', TEACHER_POOL_FILE: join(ROOT, 'data', 'teachers-writers-v1.json') }, brief: BRIEF_A,
    allowExtra: /^log \[TeacherPoolLab\] TEACHER_POOL_FILE ถูกเพิกเฉย — ต้องตั้ง CARD_LIBRARY_LAB=1/ },
  { name: 'TEACHER_POOL_FILE + CARD_LIBRARY_LAB=0 (ไม่ใช่ 1) · C rotate = เส้นเดิม + log เพิกเฉย 1 บรรทัด', env: { CARD_LIBRARY_LAB: '0', TEACHER_POOL_FILE: join(ROOT, 'data', 'teachers-writers-v1.json') }, brief: BRIEF_C,
    allowExtra: /^log \[TeacherPoolLab\] TEACHER_POOL_FILE ถูกเพิกเฉย — ต้องตั้ง CARD_LIBRARY_LAB=1/ },
];
for (const [i, fz] of FUZZ.entries()) {
  test(`ก${i + 1} พาริตี้ HEAD: ${fz.name}`, async () => {
    const usageRows = [{ picks: [{ id: ROWS[9].id }, { id: ROWS[9].id }] }]; // สมุด 7 วันมีของ (rank-v2 อ่าน)
    const wt = await stable(() => withMockDb({ usageRows }, async ({ port, st }) => ({ st, r: await runOne({ port, brief: fz.brief, env: fz.env, seed: 11 + i }) })));
    const hd = await stable(() => withMockDb({ usageRows }, async ({ port, st }) => ({ st, r: await runOne({ port, brief: fz.brief, env: fz.env, seed: 11 + i, module: HEAD_PATH }) })));
    try {
      assert.equal(wt.r.err, null, `worktree โยน: ${wt.r.err}`);
      assert.equal(hd.r.err, null, `HEAD โยน: ${hd.r.err}`);
      assert.equal(wt.r.block, hd.r.block, 'บล็อกต้องเท่า HEAD ทุกไบต์');
      assert.deepEqual(normReq(wt.st), normReq(hd.st), 'ลำดับ+URL คำขอที่ถึง PostgREST จำลองต้องเท่า HEAD');
      for (const r of getsViral(wt.st)) assert.ok(!/tags/.test(r.select), `select ต้องไม่มี tags เมื่อปิดสวิตช์: ${r.select}`);
      let logs = wt.r.logs, headLogs = hd.r.logs;
      if (fz.allowExtra) {
        const extra = logs.filter((l) => fz.allowExtra.test(l));
        assert.equal(extra.length, 1, `ต้องมี log ที่ยกเว้นได้ 1 บรรทัดพอดี: ${JSON.stringify(extra)}`);
        logs = logs.filter((l) => !fz.allowExtra.test(l));
        headLogs = headLogs.filter((l) => !fz.allowExtra.test(l)); // HEAD ที่ commit สวิตช์นี้ไปแล้วก็พิมพ์บรรทัดยกเว้นเหมือนกัน → ตัดทั้งสองฝั่ง (เทียบเฉพาะเส้นเดิม)
      }
      assert.deepEqual(logs.map(normTs), headLogs.map(normTs), 'console.log/warn/error ทั้งหมดต้องเท่า HEAD');
      assert.deepEqual(normInserted(wt.st), normInserted(hd.st), 'body ที่ POST viral_pick_history ต้องเท่า HEAD');
      assert.ok(blockHasExamples(wt.r.block) || fz.brief === BRIEF_B, 'ฉากที่มีชั้น/ข้ามหมวดได้ต้องมีครู (กันเทสผ่านเพราะทั้งคู่ว่าง)');
    } catch (e) {
      // แดง = เก็บหลักฐานทั้งสองฝั่งลงไฟล์ (assert ตัดข้อความสั้น — คำขอ/log ที่ต่างกันจะหาย) แล้วชี้พาธในข้อความ
      const dump = join(tmpdir(), `teacher-pool-parity-fail-ก${i + 1}-${process.pid}.json`);
      try { writeFileSync(dump, JSON.stringify({ case: fz.name, env: fz.env, worktree: { ...wt.r, requests: normReq(wt.st), inserted: normInserted(wt.st) }, head: { ...hd.r, requests: normReq(hd.st), inserted: normInserted(hd.st) } }, null, 2)); } catch { /* ignore */ }
      e.message = `${e.message}\n[ก${i + 1}] หลักฐานเต็ม (block/requests/logs/inserted ของ worktree+HEAD): ${dump}`;
      throw e;
    }
  });
}

// ═══ ชุด ข — TEACHER_POOL=writers-v1 ═══
const POOL = { TEACHER_POOL: 'writers-v1' };
test('ข1 SHORTLIST=1 + พูล: select มี tags + ดึงกว้าง limit 300 · ครูในบล็อกทุกใบมีป้าย · log ✅ ท้ายมี "· พูล writers-v1 (18 ใบ)"', async () => {
  await withMockDb({}, async ({ port, st }) => {
    const r = await runOne({ port, brief: BRIEF_A, env: { ...POOL, VIRAL_SHORTLIST: '1' } });
    assert.equal(r.err, null, r.err);
    const gets = getsViral(st);
    assert.equal(gets.length, 1);
    assert.equal(gets[0].select.replace(/\s+/g, ''), 'id,title,content,writing_notes,category,engagement_likes,tags'); // supabase-js ตัดช่องว่างใน select ก่อนใส่ URL
    assert.ok(/limit=300/.test(gets[0].url) && !/category=eq\./.test(gets[0].url), `ต้องดึงทั้งคลัง: ${gets[0].url}`);
    assert.ok(blockHasExamples(r.block));
    const got = teachersInBlock(r.block);
    assert.equal(got.length, 2);
    assert.ok(got.every((t) => t.tagged), `ครูในบล็อกต้องมีป้ายทุกใบ: ${got.map((t) => t.content.slice(0, 30))}`);
    assert.ok(r.logs.some((l) => /\[ViralFewshot\] ✅ 2 ตัวอย่าง .* · พูล writers-v1 \(18 ใบ\)$/.test(l)), `log ✅ ต้องลงท้ายด้วยชื่อพูล: ${r.logs.filter((l) => l.includes('✅'))}`);
    assert.ok(r.logs.some((l) => l.includes('ชั้นเฉพาะกิจ: คัดเข้ารอบ')), 'ชั้นเฉพาะกิจต้องทำงานบนพูล');
  });
});
test('ข2 rotate (ไม่กว้าง) + พูล: ยังดึงทั้งคลัง (ไม่มี category=eq.) แล้วกรองหมวดฝั่ง client · หัวบล็อกประกาศหมวด A · ครูป้ายหมวด A เท่านั้น', async () => {
  await withMockDb({}, async ({ port, st }) => {
    const r = await runOne({ port, brief: BRIEF_A, env: POOL });
    assert.equal(r.err, null, r.err);
    const gets = getsViral(st);
    assert.equal(gets.length, 1);
    assert.ok(/tags/.test(gets[0].select) && /limit=300/.test(gets[0].url) && !/category=eq\./.test(gets[0].url), gets[0].url);
    assert.ok(r.block.includes(`โพสต์ไวรัลจริงหมวด "${CAT_A}" จากเพจ`), 'หัวบล็อกต้องประกาศหมวด A (พูลมีหมวดนี้)');
    const got = teachersInBlock(r.block);
    assert.equal(got.length, 2);
    assert.ok(got.every((t) => t.tagged && t.category === CAT_A), `ต้องเป็นครูป้ายหมวด A: ${got.map((t) => `${t.category}/${t.tagged}`)}`);
    assert.ok(r.logs.some((l) => /\[ViralFewshot\] ✅ 2 ตัวอย่าง \[rotate\] จากโผ 10 ใบ .* · พูล writers-v1 \(18 ใบ\)$/.test(l)), r.logs.filter((l) => l.includes('✅')).join('\n'));
  });
});
test('ข2ข top2 (VIRAL_ROTATE=0 · ไม่กว้าง) + พูล: GET เดียว limit=300 ไม่มี category=eq. · log ✅ มี [top2] · ครู 2 ใบเป็นครูป้ายหมวด A (usable.slice(0,2) บนพูลที่กรองหมวดฝั่ง client)', async () => {
  // top2 = usable.slice(0,2) ตามลำดับแถวที่ mock ส่ง → เอาแถวป้ายหมวดอื่นขึ้นหน้าตาราง: ถ้าไม่กรองหมวดฝั่ง client จะได้ FILL_1 แทน A (เทสกัด)
  const otherFirst = [...TABLE.filter((r) => r.tags.length && r.category !== CAT_A), ...TABLE.filter((r) => !(r.tags.length && r.category !== CAT_A))];
  await withMockDb({ rows: otherFirst }, async ({ port, st }) => {
    const r = await runOne({ port, brief: BRIEF_A, env: { ...POOL, VIRAL_ROTATE: '0' } });
    assert.equal(r.err, null, r.err);
    const gets = getsViral(st);
    assert.equal(gets.length, 1);
    assert.ok(/tags/.test(gets[0].select) && /limit=300/.test(gets[0].url) && !/category=eq\./.test(gets[0].url), gets[0].url);
    assert.ok(r.block.includes(`โพสต์ไวรัลจริงหมวด "${CAT_A}" จากเพจ`), 'หัวบล็อกต้องประกาศหมวด A (พูลมีหมวดนี้)');
    const got = teachersInBlock(r.block);
    assert.equal(got.length, 2);
    assert.ok(got.every((t) => t.tagged && t.category === CAT_A), `ต้องเป็นครูป้ายหมวด A: ${got.map((t) => `${t.category}/${t.tagged}`)}`);
    assert.ok(r.logs.some((l) => /\[ViralFewshot\] ✅ 2 ตัวอย่าง \[top2\] จากโผ 10 ใบ .* · พูล writers-v1 \(18 ใบ\)$/.test(l)), r.logs.filter((l) => l.includes('✅')).join('\n'));
  });
});
test('ข3 หมวดที่พูลไม่มี (C มีแต่แถวไม่ป้าย): rotate → ยังได้ครูจากพูล (ข้ามหมวด) + หัวบล็อกไม่ประกาศหมวด C · shortlist → ครูป้าย ไม่ถอยไปแถวไม่ป้าย', async () => {
  await withMockDb({}, async ({ port }) => {
    const r = await runOne({ port, brief: BRIEF_C, env: POOL });
    assert.equal(r.err, null, r.err);
    assert.ok(blockHasExamples(r.block), 'ต้องได้ครู (ข้ามหมวดจากพูล)');
    assert.ok(r.block.includes('=== 📚 โพสต์ไวรัลจริงจากเพจ ('), 'หัวบล็อกต้องเป็นแบบข้ามหมวด');
    assert.ok(!r.block.includes(`หมวด "${CAT_C}"`), 'ห้ามประกาศหมวด C ที่พูลไม่มี');
    const got = teachersInBlock(r.block);
    assert.equal(got.length, 2);
    assert.ok(got.every((t) => t.tagged), 'ครูต้องมีป้ายทุกใบ (ห้ามถอยไปแถวไม่ป้ายหมวด C)');
  });
  await withMockDb({}, async ({ port }) => {
    const r = await runOne({ port, brief: BRIEF_C, env: { ...POOL, VIRAL_SHORTLIST: '1' } });
    assert.equal(r.err, null, r.err);
    const got = teachersInBlock(r.block);
    assert.equal(got.length, 2);
    assert.ok(got.every((t) => t.tagged), 'shortlist บนพูล: ครูต้องมีป้ายทุกใบ');
    assert.ok(!r.block.includes(`หมวด "${CAT_C}"`));
  });
});
test('ข4 ตารางไม่มีแถวป้าย (ยังไม่ --apply): บล็อกไม่มีตัวอย่าง + log พูลว่างตามสเปก + ไม่มีครูเดิมหลุดมา (ทั้ง rotate และ shortlist)', async () => {
  for (const extra of [{}, { VIRAL_SHORTLIST: '1' }]) {
    await withMockDb({ rows: TABLE_UNTAGGED }, async ({ port, st }) => {
      const r = await runOne({ port, brief: BRIEF_A, env: { ...POOL, ...extra } });
      assert.equal(r.err, null, r.err);
      assert.ok(!blockHasExamples(r.block), 'ต้องไม่มีตัวอย่างครู');
      assert.equal(teachersInBlock(r.block).length, 0, 'ครูเดิม (ไม่ป้าย) ห้ามหลุดเข้าบล็อก');
      assert.ok(r.logs.includes('log [ViralFewshot] 🧑‍🏫 TEACHER_POOL=writers-v1 แต่ไม่พบครูป้าย igdara-writers-v1 ในตาราง (0/22 แถว) → ไม่มีครูตัวอย่าง ไม่ถอยไปพูลเดิม'), r.logs.join('\n'));
      assert.ok(r.logs.some((l) => l.includes('ไม่มีตัวอย่างพอ — ใช้ Style Pack อย่างเดียว')));
      assert.equal(postsHistory(st).length, 0, 'ไม่มีครู = ไม่จดสมุด');
      assert.equal(getsViral(st).length, 1);
    });
  }
});
test('ข5 ชั้นเฉพาะกิจ + rank-v2 บนพูล: log "rank-v2 หยิบ" · ROTATE=1 → หยิบ 2 ใบไลก์จริงสูงสุดจาก viral-likes-real byId ที่ mock (ครูป้าย) · สมุดประวัติจด rank-v2', async () => {
  await withMockDb({}, async ({ port, st }) => {
    const r = await runOne({ port, brief: BRIEF_A, env: { ...POOL, VIRAL_SHORTLIST: '1', TEACHER_RANK_ROTATE: '1' } });
    assert.equal(r.err, null, r.err);
    const picked = rankPickIds(r.logs);
    assert.ok(picked, `ต้องมี log rank-v2 หยิบ: ${r.logs.join('\n')}`);
    const top2 = ROWS.filter((t) => t.tagged).sort((a, b) => b.likes - a.likes).slice(0, 2).map((t) => t.id.slice(0, 8));
    assert.deepEqual(picked.slice().sort(), top2.slice().sort(), 'ต้องหยิบ 2 ใบไลก์จริงสูงสุดของพูล (ตามไฟล์ที่ mock)');
    assert.ok(r.logs.some((l) => /💗 ไลก์จริง 18\/18 ใบ/.test(l)), `_applyRealLikes ต้องเห็นไลก์จริงครบพูล: ${r.logs.filter((l) => l.includes('💗'))}`);
    assert.equal(st.inserted.length, 1, 'โหมด production ยังจดสมุด');
    assert.equal(st.inserted[0].data.mode, 'rank-v2');
    assert.deepEqual(st.inserted[0].data.picks.map((p) => p.id.slice(0, 8)).sort(), picked.slice().sort());
    assert.equal(st.inserted[0].data.libSize, 18, 'libSize = ขนาดพูล (ไม่ใช่ 40)');
  });
});
test('ข6 แคชแยกจากพูลเดิม: ปิด→เปิด→ปิด→เปิด ในโปรเซสเดียว = GET 2 ครั้ง (select ไม่มี tags แล้วมี tags) และครูของรอบเปิดมีป้าย/รอบปิดอาจไม่ป้าย', async () => {
  await withMockDb({}, async ({ port, st }) => {
    const rs = await runChild({ port, calls: [
      { brief: BRIEF_A, env: { VIRAL_SHORTLIST: '1', TEACHER_POOL: null } },
      { brief: BRIEF_A, env: { TEACHER_POOL: 'writers-v1' } },
      { brief: BRIEF_A, env: { TEACHER_POOL: null } },
      { brief: BRIEF_A, env: { TEACHER_POOL: 'writers-v1' } },
    ] });
    for (const r of rs) assert.equal(r.err, null, r.err);
    const gets = getsViral(st);
    assert.equal(gets.length, 2, `ต้องดึง 2 ก้อน (พูลเดิม + พูลป้าย) แล้วแคชแยกกัน: ${gets.map((g) => g.url).join('\n')}`);
    assert.ok(!/tags/.test(gets[0].select) && /tags/.test(gets[1].select));
    assert.ok(teachersInBlock(rs[1].block).every((t) => t.tagged) && teachersInBlock(rs[3].block).every((t) => t.tagged), 'รอบเปิดต้องได้ครูป้ายเท่านั้น');
    assert.ok(rs[1].logs.some((l) => l.endsWith('· พูล writers-v1 (18 ใบ)')) && !rs[2].logs.some((l) => l.includes('พูล writers-v1')));
    assert.equal(rs[2].logs.filter((l) => l.includes('✅')).length, 1, 'รอบปิดจากแคช (พูลเดิม 40 ใบ) ยังได้ครูตามเดิม');
    assert.ok(rs[2].logs.some((l) => /จากโผ \d+ ใบ \(คลัง 40\)/.test(l)), `รอบปิดต้องเห็นคลัง 40 (แคชพูลเดิม): ${rs[2].logs.filter((l) => l.includes('✅'))}`);
  });
});

// ═══ ชุด ค — TEACHER_POOL_FILE (ห้องแล็บ) ═══
const LAB_FILE = join(TMP, 'pool-lab.json');
const LAB_TEACHERS = Array.from({ length: 6 }, (_, i) => ({
  id: uuidOf(`lab-${i}`), source: POOL_TAG, author: i % 2 ? 'Po Ny' : 'Nisada Jaraket', tier: i < 2 ? 'master' : 'senior',
  engagement_likes: i === 3 ? 190000 : i === 1 ? 120000 : 40000 + i * 5000, category: CAT_A,
  title: `ครูแล็บ${i}`, content: `เนื้อครูแล็บ-${i} ` + 'ข'.repeat(300), writing_notes: `โน้ตแล็บ ${i}`,
  tags: [POOL_TAG, `author:x`, 'tier:senior'], essence: ess(i === 3 || i === 1 ? THEMES_FULL : THEMES_LITE, `lab${i}`),
}));
writeFileSync(LAB_FILE, JSON.stringify({ kind: 'teachers-writers-v1', source: POOL_TAG, version: 1, teachers: LAB_TEACHERS }));
const LAB = { CARD_LIBRARY_LAB: '1', TEACHER_POOL_FILE: LAB_FILE, VIRAL_SHORTLIST: '1', TEACHER_RANK_ROTATE: '1' };

test('ค1-4 LAB=1 + ไฟล์: ไม่มี GET viral_examples · ครูจากไฟล์ · ประกาศตัวมีพาธ · ไลก์จากไฟล์ถึง _applyRealLikes (6/6) และ rank-v2 (หยิบ 2 ใบไลก์สูงสุดตามไฟล์) · บัตรจากไฟล์ (cwd ไม่มี data/) · ไม่ POST สมุด + log ข้าม', async () => {
  await withMockDb({}, async ({ port, st }) => {
    const r = await runOne({ port, brief: BRIEF_A, env: LAB, cwd: CWD_EMPTY });
    assert.equal(r.err, null, r.err);
    assert.equal(getsViral(st).length, 0, `ห้ามยิง viral_examples: ${st.requests.map((x) => x.url)}`);
    assert.ok(blockHasExamples(r.block));
    const got = LAB_TEACHERS.filter((t, i) => r.block.includes(`เนื้อครูแล็บ-${i} `));
    assert.equal(got.length, 2, 'ครู 2 ใบต้องมาจากไฟล์');
    assert.equal(teachersInBlock(r.block).length, 0, 'ครูจากตารางห้ามโผล่');
    assert.ok(r.logs.includes(`log [TeacherPoolLab] โหมดแล็บทำงาน — อ่านครูจากไฟล์: ${LAB_FILE} (6 ใบ) · ไม่แตะ viral_examples · ไม่จดสมุดประวัติ`), r.logs.join('\n'));
    assert.ok(r.logs.some((l) => /💗 ไลก์จริง 6\/6 ใบ/.test(l)), `ไลก์จากไฟล์ต้องถึง _applyRealLikes: ${r.logs.filter((l) => l.includes('💗'))}`);
    const picked = rankPickIds(r.logs);
    assert.ok(picked, `ต้องมี rank-v2 หยิบ: ${r.logs.join('\n')}`);
    const top2 = LAB_TEACHERS.slice().sort((a, b) => b.engagement_likes - a.engagement_likes).slice(0, 2).map((t) => t.id.slice(0, 8));
    assert.deepEqual(picked.slice().sort(), top2.slice().sort(), 'rank-v2 ต้องหยิบ 2 ใบไลก์สูงสุดตามไฟล์พูล');
    assert.ok(!r.logs.some((l) => l.includes('บัตรลักษณะว่าง')), 'บัตรจากไฟล์ต้องทำให้ชั้นเฉพาะกิจไม่ถอย');
    assert.ok(r.logs.some((l) => l.includes('ชั้นเฉพาะกิจ: คัดเข้ารอบ')));
    assert.equal(postsHistory(st).length, 0, 'ห้ามจดสมุดประวัติ');
    assert.ok(r.logs.includes('log [TeacherPoolLab] ข้ามการจดสมุดประวัติ (โหมดแล็บ TEACHER_POOL_FILE)'), r.logs.join('\n'));
  });
});
test('ค2ข VIRAL_HITS_FORMULA=0 ในแล็บ: _applyRealLikes ไม่ถ่วง (ไม่มี log 💗) แต่ rank-v2 ยังเห็นไลก์จากไฟล์', async () => {
  await withMockDb({}, async ({ port }) => {
    const r = await runOne({ port, brief: BRIEF_A, env: { ...LAB, VIRAL_HITS_FORMULA: '0' }, cwd: CWD_EMPTY });
    assert.equal(r.err, null, r.err);
    assert.ok(!r.logs.some((l) => l.includes('💗')), 'สูตรแสนไลก์ปิด = ไม่ถ่วง');
    const top2 = LAB_TEACHERS.slice().sort((a, b) => b.engagement_likes - a.engagement_likes).slice(0, 2).map((t) => t.id.slice(0, 8));
    assert.deepEqual((rankPickIds(r.logs) || []).slice().sort(), top2.slice().sort());
  });
});
test('ค5 VERCEL=1 (และ VERCEL_ENV): เพิกเฉยไฟล์ + console.error ครั้งเดียว + ยิง Supabase ตามเดิม + จดสมุด', async () => {
  for (const venv of [{ VERCEL: '1' }, { VERCEL_ENV: 'preview' }]) {
    await withMockDb({}, async ({ port, st }) => {
      const r = await runOne({ port, brief: BRIEF_A, env: { ...LAB, ...venv } });
      assert.equal(r.err, null, r.err);
      assert.equal(getsViral(st).length, 1, 'ต้องยิง viral_examples ตามเดิม');
      assert.equal(r.logs.filter((l) => l.startsWith('error [TeacherPoolLab] TEACHER_POOL_FILE ถูกเพิกเฉย — ตรวจพบ Vercel env')).length, 1, r.logs.join('\n'));
      assert.ok(!r.logs.some((l) => l.includes('โหมดแล็บทำงาน')));
      assert.equal(teachersInBlock(r.block).length, 2, 'ครูต้องมาจากตาราง');
      assert.equal(postsHistory(st).length, 1, 'เส้นเดิมยังจดสมุด');
    });
  }
});
test('ค6 ไฟล์หาย / JSON พัง / ไม่มี teachers: console.error + error ข้อความมี TEACHER_POOL_FILE · ไม่มี GET viral_examples · บล็อกไม่มีครู (ไม่ถอยไป Supabase)', async () => {
  const broken = join(TMP, 'broken.json'); writeFileSync(broken, '{ not json');
  const empty = join(TMP, 'empty.json'); writeFileSync(empty, JSON.stringify({ teachers: [] }));
  const noId = join(TMP, 'no-id.json'); writeFileSync(noId, JSON.stringify({ teachers: LAB_TEACHERS.map(({ id, ...t }) => t) })); // มี teachers แต่ไม่มี id สักใบ
  const allShort = join(TMP, 'all-short.json'); writeFileSync(allShort, JSON.stringify(LAB_TEACHERS.map((t) => ({ ...t, content: 'สั้น'.repeat(40) })))); // ทุกใบเนื้อ ≤ 200 (เกณฑ์เดียวกับเส้น Supabase)
  for (const file of [join(TMP, 'missing-pool.json'), broken, empty, noId, allShort]) {
    await withMockDb({}, async ({ port, st }) => {
      const r = await runOne({ port, brief: BRIEF_A, env: { ...LAB, TEACHER_POOL_FILE: file } });
      assert.equal(r.err, null, 'getViralFewshotBlock ต้องไม่โยนออก (catch ก้อนนอกครอบ)');
      assert.equal(getsViral(st).length, 0, 'ห้ามถอยไป Supabase');
      assert.ok(!blockHasExamples(r.block));
      assert.ok(r.logs.some((l) => l.startsWith('error [TeacherPoolLab] TEACHER_POOL_FILE อ่านไม่ได้') && l.includes(file)), r.logs.join('\n'));
      assert.ok(r.logs.some((l) => l.startsWith('log [ViralFewshot] ⚠️ fetch failed (non-fatal):') && l.includes('TEACHER_POOL_FILE')), r.logs.join('\n'));
      assert.equal(postsHistory(st).length, 0);
    });
  }
});
test('ค7 ไฟล์จริง data/teachers-writers-v1.json: ได้ครู 2 ใบจาก 28 ใบ (เนื้อตรงไฟล์) · ไม่ยิง viral_examples · ไม่จดสมุด', async () => {
  const realFile = join(ROOT, 'data', 'teachers-writers-v1.json');
  const real = JSON.parse(readFileSync(realFile, 'utf8'));
  assert.equal(real.teachers.length, 28);
  await withMockDb({}, async ({ port, st }) => {
    const r = await runOne({ port, brief: BRIEF_A, env: { ...LAB, TEACHER_POOL_FILE: realFile }, cwd: ROOT });
    assert.equal(r.err, null, r.err);
    assert.equal(getsViral(st).length, 0);
    assert.ok(r.logs.includes(`log [TeacherPoolLab] โหมดแล็บทำงาน — อ่านครูจากไฟล์: ${realFile} (28 ใบ) · ไม่แตะ viral_examples · ไม่จดสมุดประวัติ`), r.logs.join('\n'));
    const parts = r.block.split(/--- ตัวอย่าง \d ---\n/).slice(1);
    assert.equal(parts.length, 2, 'ต้องได้ครู 2 ใบ');
    for (const p of parts) assert.ok(real.teachers.some((t) => p.startsWith(t.content.slice(0, 120))), `เนื้อครูต้องมาจากไฟล์จริง: ${p.slice(0, 60)}`);
    assert.equal(postsHistory(st).length, 0);
  });
});
test('ค6ข ไฟล์แล็บปนใบเนื้อสั้น: ตัดใบ ≤ 200 ออกเหมือนเส้น Supabase · ประกาศ "(N ใบ · ตัดเนื้อสั้น M)" · ใบสั้นไม่เข้าบล็อก', async () => {
  const mixedLen = join(TMP, 'pool-short-mixed.json');
  writeFileSync(mixedLen, JSON.stringify(LAB_TEACHERS.map((t, i) => (i === 1 || i === 3 ? { ...t, content: `เนื้อครูแล็บ-${i} สั้น` } : t)))); // ตัด 2 ใบไลก์สูงสุดให้สั้น
  await withMockDb({}, async ({ port, st }) => {
    const r = await runOne({ port, brief: BRIEF_A, env: { ...LAB, TEACHER_POOL_FILE: mixedLen }, cwd: CWD_EMPTY });
    assert.equal(r.err, null, r.err);
    assert.equal(getsViral(st).length, 0);
    assert.ok(r.logs.includes(`log [TeacherPoolLab] โหมดแล็บทำงาน — อ่านครูจากไฟล์: ${mixedLen} (4 ใบ · ตัดเนื้อสั้น 2) · ไม่แตะ viral_examples · ไม่จดสมุดประวัติ`), r.logs.join('\n'));
    const got = LAB_TEACHERS.filter((t, i) => r.block.includes(`เนื้อครูแล็บ-${i} `));
    assert.equal(got.length, 2);
    assert.ok(got.every((t) => ![1, 3].includes(LAB_TEACHERS.indexOf(t))), 'ใบเนื้อสั้นห้ามเข้าบล็อก');
    assert.ok(!r.block.includes('เนื้อครูแล็บ-1 สั้น') && !r.block.includes('เนื้อครูแล็บ-3 สั้น'));
    assert.ok(r.logs.some((l) => /💗 ไลก์จริง 4\/4 ใบ/.test(l)), r.logs.filter((l) => l.includes('💗')).join('\n'));
  });
});
test('ค9 แล็บโหมดไม่กว้าง (rotate · ไม่ตั้ง VIRAL_SHORTLIST): กติกาหมวด/crossCat เหมือน 2.1 — ข่าว C กับไฟล์ที่มีแต่หมวด A → ครูจากไฟล์ 2 ใบ + หัวบล็อกข้ามหมวด ไม่ประกาศหมวด C · ข่าว A → หัวบล็อกประกาศหมวด A · ไม่มี GET viral_examples · ไม่จดสมุด', async () => {
  const LAB_ROTATE = { ...LAB, VIRAL_SHORTLIST: null };
  await withMockDb({}, async ({ port, st }) => {
    const r = await runOne({ port, brief: BRIEF_C, env: LAB_ROTATE, cwd: CWD_EMPTY });
    assert.equal(r.err, null, r.err);
    assert.equal(getsViral(st).length, 0, `ห้ามยิง viral_examples: ${st.requests.map((x) => x.url)}`);
    assert.ok(blockHasExamples(r.block), 'ต้องได้ครู (ข้ามหมวดจากไฟล์)');
    assert.ok(r.block.includes('=== 📚 โพสต์ไวรัลจริงจากเพจ ('), 'หัวบล็อกต้องเป็นแบบข้ามหมวด');
    assert.ok(!r.block.includes(`หมวด "${CAT_C}"`), 'ห้ามประกาศหมวด C ที่ไฟล์ไม่มี');
    assert.equal(LAB_TEACHERS.filter((t, i) => r.block.includes(`เนื้อครูแล็บ-${i} `)).length, 2, 'ครู 2 ใบต้องมาจากไฟล์');
    assert.equal(teachersInBlock(r.block).length, 0, 'ครูจากตารางห้ามโผล่');
    assert.ok(r.logs.some((l) => /\[ViralFewshot\] ✅ 2 ตัวอย่าง \[rotate\] /.test(l)), r.logs.filter((l) => l.includes('✅')).join('\n'));
    assert.equal(postsHistory(st).length, 0, 'ห้ามจดสมุดประวัติ');
  });
  await withMockDb({}, async ({ port, st }) => {
    const r = await runOne({ port, brief: BRIEF_A, env: LAB_ROTATE, cwd: CWD_EMPTY });
    assert.equal(r.err, null, r.err);
    assert.equal(getsViral(st).length, 0);
    assert.ok(r.block.includes(`โพสต์ไวรัลจริงหมวด "${CAT_A}" จากเพจ`), 'ไฟล์มีหมวด A → หัวบล็อกประกาศหมวด A');
    assert.equal(LAB_TEACHERS.filter((t, i) => r.block.includes(`เนื้อครูแล็บ-${i} `)).length, 2);
    assert.equal(postsHistory(st).length, 0);
  });
});
test('ค8 ตั้งคู่ TEACHER_POOL=writers-v1 + ไฟล์แล็บ: กรองป้ายบนไฟล์ด้วย (ใบไม่มีป้ายในไฟล์ไม่ถูกหยิบ) + log ✅ มีชื่อพูล', async () => {
  const mixed = join(TMP, 'pool-mixed.json');
  writeFileSync(mixed, JSON.stringify(LAB_TEACHERS.map((t, i) => (i < 4 ? { ...t, tags: [] } : t)))); // อาเรย์ตรงๆ · 4 ใบแรกไม่มีป้าย (รวมใบไลก์สูงสุด 2 ใบ)
  await withMockDb({}, async ({ port }) => {
    const r = await runOne({ port, brief: BRIEF_A, env: { ...LAB, TEACHER_POOL_FILE: mixed, TEACHER_POOL: 'writers-v1' }, cwd: CWD_EMPTY });
    assert.equal(r.err, null, r.err);
    const got = LAB_TEACHERS.filter((t, i) => r.block.includes(`เนื้อครูแล็บ-${i} `));
    assert.deepEqual(got.map((t) => LAB_TEACHERS.indexOf(t)).sort(), [4, 5], 'ต้องได้เฉพาะ 2 ใบที่มีป้าย');
    assert.ok(r.logs.some((l) => l.endsWith('· พูล writers-v1 (2 ใบ)')), r.logs.filter((l) => l.includes('✅')).join('\n'));
  });
});

// ═══ ชุด X (พาริตี้ HEAD เสริม — ทีมหักล้าง 4 ก.ย. 69) — หลายเรียกในโปรเซสเดียว / error / ไม่มี sb / ตารางว่าง / fail-closed Vercel ═══
const NOFILE = join(ROOT, 'data', 'teachers-writers-v1.json');
const X = [
  { name: 'X1 default rotate · [A, C, A, B] แคชต่อหมวด', env: {}, calls: [BRIEF_A, BRIEF_C, BRIEF_A, BRIEF_B] },
  { name: 'X2 SHORTLIST=1 · [A, B, C] แคช __all__', env: { VIRAL_SHORTLIST: '1' }, calls: [BRIEF_A, BRIEF_B, BRIEF_C] },
  { name: 'X3 ROTATE=0 · [A, C, A]', env: { VIRAL_ROTATE: '0' }, calls: [BRIEF_A, BRIEF_C, BRIEF_A] },
  { name: 'X4 PostgREST 500 · default [A, A]', env: {}, calls: [BRIEF_A, BRIEF_A], viralStatus: 500 },
  { name: 'X5 PostgREST 500 · SHORTLIST=1 [A, C]', env: { VIRAL_SHORTLIST: '1' }, calls: [BRIEF_A, BRIEF_C], viralStatus: 500 },
  { name: 'X6 ไม่มี Supabase env · [A] default และ SHORTLIST', env: { NEXT_PUBLIC_SUPABASE_URL: null, SUPABASE_SERVICE_KEY: null }, calls: [BRIEF_A] },
  { name: 'X6b ไม่มี Supabase env · SHORTLIST=1 [A]', env: { NEXT_PUBLIC_SUPABASE_URL: null, SUPABASE_SERVICE_KEY: null, VIRAL_SHORTLIST: '1' }, calls: [BRIEF_A] },
  { name: 'X7 ตารางว่าง · SHORTLIST=1 [A, C]', env: { VIRAL_SHORTLIST: '1' }, calls: [BRIEF_A, BRIEF_C], rows: [] },
  { name: 'X7b ตารางว่าง · rotate [A]', env: {}, calls: [BRIEF_A], rows: [] },
  { name: 'X8 FILE+LAB=1+VERCEL_ENV=production (fail-closed) · SHORTLIST [A, C] = HEAD + error 1 บรรทัด', env: { VIRAL_SHORTLIST: '1', CARD_LIBRARY_LAB: '1', TEACHER_POOL_FILE: NOFILE, VERCEL_ENV: 'production' }, calls: [BRIEF_A, BRIEF_C],
    allowExtra: /^error \[TeacherPoolLab\] TEACHER_POOL_FILE ถูกเพิกเฉย — ตรวจพบ Vercel env/ },
  { name: 'X9 FILE+LAB=1+VERCEL=1 · rotate [A, A]', env: { CARD_LIBRARY_LAB: '1', TEACHER_POOL_FILE: NOFILE, VERCEL: '1' }, calls: [BRIEF_A, BRIEF_A],
    allowExtra: /^error \[TeacherPoolLab\] TEACHER_POOL_FILE ถูกเพิกเฉย — ตรวจพบ Vercel env/ },
  { name: 'X10 FILE ตั้ง LAB ไม่ตั้ง · rotate [A, C] = log เพิกเฉย 1 บรรทัดทั้งโปรเซส', env: { TEACHER_POOL_FILE: NOFILE }, calls: [BRIEF_A, BRIEF_C],
    allowExtra: /^log \[TeacherPoolLab\] TEACHER_POOL_FILE ถูกเพิกเฉย — ต้องตั้ง CARD_LIBRARY_LAB=1/ },
  { name: 'X11 สลับ env ระหว่างเรียก: default → TEACHER_POOL=writers-v9 → TEACHER_POOL="" (SHORTLIST)', env: { VIRAL_SHORTLIST: '1' }, calls: [BRIEF_A, BRIEF_A, BRIEF_A], callEnvs: [{}, { TEACHER_POOL: 'writers-v9' }, { TEACHER_POOL: '' }],
    allowExtra: /^log \[ViralFewshot\] 🧑‍🏫 TEACHER_POOL="writers-v9" อ่านไม่ออก/ },
  { name: 'X12 FILE ชี้ไฟล์ที่ไม่มีจริง + LAB=0 · [A] = เส้นเดิม (ไม่อ่านไฟล์)', env: { CARD_LIBRARY_LAB: '0', TEACHER_POOL_FILE: join(TMP, 'no-such-file.json') }, calls: [BRIEF_A],
    allowExtra: /^log \[TeacherPoolLab\] TEACHER_POOL_FILE ถูกเพิกเฉย — ต้องตั้ง CARD_LIBRARY_LAB=1/ },
  { name: 'X13 FILE ชี้ไฟล์ที่ไม่มีจริง + LAB=1 + VERCEL_ENV=preview · SHORTLIST [A] = เส้นเดิม (fail-closed ไม่อ่านไฟล์)', env: { VIRAL_SHORTLIST: '1', CARD_LIBRARY_LAB: '1', TEACHER_POOL_FILE: join(TMP, 'no-such-file.json'), VERCEL_ENV: 'preview' }, calls: [BRIEF_A],
    allowExtra: /^error \[TeacherPoolLab\] TEACHER_POOL_FILE ถูกเพิกเฉย — ตรวจพบ Vercel env/ },
  { name: 'X14 TEACHER_POOL=" WRITERS-V9 " (ช่องว่าง/ตัวใหญ่ อ่านไม่ออก) · rotate [A]', env: { TEACHER_POOL: ' WRITERS-V9 ' }, calls: [BRIEF_A],
    allowExtra: /^log \[ViralFewshot\] 🧑‍🏫 TEACHER_POOL="writers-v9" อ่านไม่ออก/ },
];
for (const [i, fz] of X.entries()) {
  test(`${fz.name}`, async () => {
    const usageRows = [{ picks: [{ id: ROWS[9].id }, { id: ROWS[9].id }] }];
    const mk = (module) => withMockDb({ usageRows, rows: fz.rows, viralStatus: fz.viralStatus }, async ({ port, st }) => ({
      st, r: await runChild({ port, module, env: fz.env, seed: 101 + i, calls: fz.calls.map((brief, j) => ({ brief, env: (fz.callEnvs || [])[j] || {} })) }),
    }));
    const wt = await stable(() => mk(SRC_PATH)), hd = await stable(() => mk(HEAD_PATH));
    try {
      assert.equal(wt.r.length, hd.r.length);
      let extraSeen = 0;
      for (let j = 0; j < wt.r.length; j++) {
        assert.equal(wt.r[j].err, hd.r[j].err, `call ${j} err`);
        assert.equal(wt.r[j].block, hd.r[j].block, `call ${j} บล็อกต้องเท่า HEAD ทุกไบต์`);
        let logs = wt.r[j].logs, headLogs = hd.r[j].logs;
        if (fz.allowExtra) { const ex = logs.filter((l) => fz.allowExtra.test(l)); extraSeen += ex.length; logs = logs.filter((l) => !fz.allowExtra.test(l)); headLogs = headLogs.filter((l) => !fz.allowExtra.test(l)); } // ตัดบรรทัดยกเว้นทั้งสองฝั่ง (HEAD อาจมีสวิตช์นี้แล้ว)
        assert.deepEqual(logs.map(normTs), headLogs.map(normTs), `call ${j} logs`);
      }
      if (fz.allowExtra) assert.equal(extraSeen, 1, 'log ยกเว้นต้องมี 1 บรรทัดพอดีทั้งโปรเซส');
      assert.deepEqual(normReq(wt.st), normReq(hd.st), 'คำขอ PostgREST ทั้งโปรเซสต้องเท่า HEAD');
      for (const r of getsViral(wt.st)) assert.ok(!/tags/.test(r.select));
      assert.deepEqual(normInserted(wt.st), normInserted(hd.st), 'สมุดประวัติ');
    } catch (e) {
      const dump = join(tmpdir(), `parity-extra-fail-X${i + 1}-${process.pid}.json`);
      try { writeFileSync(dump, JSON.stringify({ case: fz.name, worktree: { r: wt.r, requests: normReq(wt.st), inserted: normInserted(wt.st) }, head: { r: hd.r, requests: normReq(hd.st), inserted: normInserted(hd.st) } }, null, 2)); } catch { /* ignore */ }
      e.message = `${e.message}\n[${fz.name}] หลักฐาน: ${dump}`;
      throw e;
    }
  });
}

test('ข6ข แคชโหมดจับคู่ (VIRAL_MATCH_MODE=score) แยกพูล: ข่าวชื่อเดิม ปิด→พูลป้าย→แล็บไฟล์ ในโปรเซสเดียว ต้องไม่ได้ครูชุดเดิมหลุด', async () => {
  await withMockDb({}, async ({ port, st }) => {
    const brief = { ...BRIEF_A, newsTitle: 'ข่าวเดียวกันทุกรอบ', title: 'ข่าวเดียวกันทุกรอบ' };
    const rs = await runChild({ port, env: { VIRAL_SHORTLIST: '1', VIRAL_MATCH_MODE: 'score' }, calls: [
      { brief, env: { TEACHER_POOL: null } },
      { brief, env: { TEACHER_POOL: 'writers-v1' } },
      { brief, env: { TEACHER_POOL: null, CARD_LIBRARY_LAB: '1', TEACHER_POOL_FILE: LAB_FILE } },
      { brief, env: { CARD_LIBRARY_LAB: null, TEACHER_POOL_FILE: null } },
    ] });
    for (const r of rs) assert.equal(r.err, null, r.err);
    assert.ok(teachersInBlock(rs[0].block).some((x) => !x.tagged), 'รอบปิดได้ครูพูลเดิม');
    const t1 = teachersInBlock(rs[1].block);
    assert.ok(t1.length && t1.every((x) => x.tagged), 'รอบพูลป้ายต้องได้ครูป้ายเท่านั้น (ห้ามได้จากแคชโหมดจับคู่ของรอบปิด): ' + t1.map((x) => x.tagged));
    assert.ok(/เนื้อครูแล็บ-/.test(rs[2].block) && teachersInBlock(rs[2].block).length === 0, 'รอบแล็บต้องได้ครูจากไฟล์เท่านั้น');
    assert.ok(teachersInBlock(rs[3].block).some((x) => !x.tagged), 'กลับมาปิด = ครูพูลเดิม (คีย์เดิม)');
  });
});
