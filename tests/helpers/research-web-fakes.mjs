// ============================================================
// 🧪 tests/helpers/research-web-fakes.mjs — ของปลอมร่วมของเทส Research Agent v2 ฝั่งเว็บ (เลน B · 1 ต.ค. 69)
// ------------------------------------------------------------
// 1) createFakeSupabase(): ตาราง store_items ในหน่วยความจำ — PK = id ทั้งตาราง (เลียนของจริง: โค้ดเดิม upsert onConflict:'id')
//    รองรับ select/eq(รวม 'data->>field')/order/limit/maybeSingle/insert(+select)/update(+select) · ชน PK = error code 23505
//    failNext(n, where) = ให้คำสั่งถัดไป n ครั้งล้ม (ทดสอบ fail-open/503) · ไม่ต่อเน็ต ไม่เขียนไฟล์
// 2) installResearchHooks(): module.registerHooks — '@/…' → ไฟล์จริงใต้ src (หรือ stub เป็น data: URL) · 'next/server' → ตัวปลอม
//    (NextResponse.json = Response.json · after() เก็บ callback ไว้ให้เทสสั่งรัน) · บันทึกทุก specifier '@/' ที่ถูก resolve
//    (ใช้พิสูจน์ "ปิดสวิตช์ = ไม่ import โมดูลรีเสิร์ชเลย")
// 3) fixtures รูปสัญญา 2.2 แปลงจากผลจริงของเอเจนต์ (C:\tmp\research-agent-lab\out\result.json · out2\result.json — 1 ต.ค. 69)
//    ฝังไว้ในไฟล์นี้ (CI ไม่มีโฟลเดอร์แล็บ) — ข้อความการ์ด/หลักฐาน/URL ตรงต้นฉบับ · gate ตั้ง 'pass' ทุกใบเพื่อทดสอบด่านฝั่งเว็บ
// ============================================================
import { registerHooks } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const srcUrl = (rel) => pathToFileURL(join(ROOT, 'src', rel)).href;

// ── 1) Supabase ปลอม ─────────────────────────────────────────────
function readPath(row, column) {
  if (column === 'id' || column === 'store_name' || column === 'created_at' || column === 'updated_at') return row[column];
  const m = /^data->>(\w+)$/.exec(column);
  if (m) {
    const value = row.data?.[m[1]];
    return value === undefined || value === null ? null : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  throw new Error(`fake supabase: column ${column} not supported`);
}

export function createFakeSupabase() {
  const rows = new Map(); // id → {id, store_name, data, created_at, updated_at}
  const calls = [];
  const failures = [];
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  function shouldFail(kind, filters) {
    const index = failures.findIndex((f) => !f.kind || f.kind === kind);
    if (index < 0) return null;
    const failure = failures[index];
    if (failure.where && !failure.where(kind, filters)) return null;
    failure.count -= 1;
    if (failure.count <= 0) failures.splice(index, 1);
    return failure.mode || 'error';
  }

  function builder(table) {
    const state = { table, op: 'select', filters: [], order: null, limit: null, single: false, payload: null, returning: false };
    const api = {
      select(cols) { if (state.op === 'select') state.cols = cols; else state.returning = true; return api; },
      eq(column, value) { state.filters.push([column, value]); return api; },
      order(column, opts = {}) { state.order = [column, opts.ascending !== false]; return api; },
      limit(n) { state.limit = n; return api; },
      maybeSingle() { state.single = true; return api; },
      insert(payload) { state.op = 'insert'; state.payload = payload; return api; },
      update(payload) { state.op = 'update'; state.payload = payload; return api; },
      then(resolve, reject) {
        return Promise.resolve().then(() => execute(state)).then(resolve, reject);
      },
    };
    return api;
  }

  function matches(row, filters) {
    return filters.every(([column, value]) => readPath(row, column) === (value === null ? null : String(value)));
  }

  function execute(state) {
    calls.push({ table: state.table, op: state.op, filters: clone(state.filters), payload: clone(state.payload) });
    if (state.table !== 'store_items') throw new Error(`fake supabase: table ${state.table}`);
    const failure = shouldFail(state.op, state.filters);
    if (failure === 'throw') throw new Error('SECRET transport failure detail');
    if (failure === 'hang') return new Promise(() => {});
    if (failure) return { data: null, error: { message: 'SECRET database detail', code: 'XX000' } };
    if (state.op === 'insert') {
      const list = Array.isArray(state.payload) ? state.payload : [state.payload];
      for (const row of list) {
        if (rows.has(row.id)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "store_items_pkey"' } };
      }
      for (const row of list) rows.set(row.id, clone(row));
      return { data: state.returning ? list.map((r) => ({ id: r.id })) : null, error: null };
    }
    if (state.op === 'update') {
      const hit = [...rows.values()].filter((row) => matches(row, state.filters));
      for (const row of hit) Object.assign(row, clone(state.payload));
      return { data: state.returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    let list = [...rows.values()].filter((row) => matches(row, state.filters));
    if (state.order) {
      const [column, asc] = state.order;
      list.sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : String(a[column]) > String(b[column]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (Number.isInteger(state.limit)) list = list.slice(0, state.limit);
    const shaped = list.map((row) => (state.cols === 'data' ? { data: clone(row.data) } : { id: row.id, data: clone(row.data) }));
    if (state.single) return { data: shaped[0] ?? null, error: null };
    return { data: shaped, error: null };
  }

  return {
    from: (table) => builder(table),
    rows,
    calls,
    /** n คำสั่งถัดไป (เฉพาะ kind ถ้าระบุ: select|insert|update) ล้ม · mode: 'error' | 'throw' | 'hang' */
    failNext(count = 1, { kind = null, mode = 'error', where = null } = {}) { failures.push({ count, kind, mode, where }); },
    clearFailures() { failures.length = 0; },
    seed(id, storeName, data, createdAt = '2026-10-01T00:00:00.000Z') {
      rows.set(id, { id, store_name: storeName, data: clone(data), created_at: createdAt, updated_at: createdAt });
    },
    doc(id) { return clone(rows.get(id)?.data ?? null); },
  };
}

// ── 2) hooks ของโมดูล ────────────────────────────────────────────
const NEXT_SERVER_STUB = `
export const NextResponse = { json: (body, init) => Response.json(body, init) };
export const after = (fn) => { (globalThis.__RA_AFTER ||= []).push(fn); };
`;
const dataUrl = (label, source) => `data:text/javascript,${encodeURIComponent(`/*${label}*/\n${source}`)}`;

function resolveAlias(specifier) {
  const rel = specifier.slice(2);
  for (const candidate of [rel, `${rel}.js`, `${rel}.mjs`, `${rel}/index.js`]) {
    const file = join(ROOT, 'src', candidate);
    if (/\.(m?js)$/.test(file) && existsSync(file) && statSync(file).isFile()) return pathToFileURL(file).href;
  }
  return null;
}

/**
 * ติดตั้ง hook ครั้งเดียวต่อไฟล์เทส
 * @param {{ stubs?: Record<string,string>, parentStubs?: Array<{ specifier: string, parentEndsWith: string, source: string }> }} opts
 *   stubs = specifier ('@/…' หรือแพ็กเกจ) → ซอร์ส ESM ของตัวปลอม · parentStubs = stub เฉพาะเมื่อ parent ตรงไฟล์ (import สัมพัทธ์)
 * @returns {{ resolved: string[], overrides: Map<string,string> }} resolved = '@/…' ที่ถูกขอ (ตามลำดับ) · overrides ตั้งระหว่างเทสได้
 */
export function installResearchHooks({ stubs = {}, parentStubs = [] } = {}) {
  const resolved = [];
  const overrides = new Map();
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) resolved.push(specifier);
      if (overrides.has(specifier)) return { url: overrides.get(specifier), shortCircuit: true };
      if (Object.hasOwn(stubs, specifier)) return { url: dataUrl(specifier, stubs[specifier]), shortCircuit: true };
      if (specifier === 'next/server') return { url: dataUrl('next/server', NEXT_SERVER_STUB), shortCircuit: true };
      for (const stub of parentStubs) {
        if (specifier === stub.specifier && String(context.parentURL || '').endsWith(stub.parentEndsWith)) {
          return { url: dataUrl(`${specifier}@${stub.parentEndsWith}`, stub.source), shortCircuit: true };
        }
      }
      if (specifier.startsWith('@/')) {
        const url = resolveAlias(specifier);
        if (url) return { url, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  return { resolved, overrides };
}

/** โหลดซอร์สที่ patch แล้วเป็นโมดูลใหม่ (data: URL · import '@/…' ผ่าน hook ได้ · ห้ามมี import สัมพัทธ์) */
export async function importSource(source, tag) {
  if (/from\s+['"]\.{1,2}\//.test(source) || /import\(\s*['"]\.{1,2}\//.test(source)) {
    throw new Error(`importSource(${tag}): ซอร์สมี import สัมพัทธ์ — โหลดจาก data: URL ไม่ได้`);
  }
  const encoded = Buffer.from(`${source}\n//# sourceURL=${tag}.mjs`, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${tag}`);
}

/** แทนข้อความครั้งเดียวแบบเป๊ะ (ไม่เจอ/เจอหลายที่ = โยน เพื่อไม่ให้ mutation เขียวหลอก) */
export function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`replaceOnce(${label}): พบ ${count} ที่ (ต้อง 1)`);
  return source.replace(search, () => replacement);
}

// ── 3) fixtures (สัญญา 2.2) ──────────────────────────────────────
const OUT1_PLAN = [
  { question: 'ต้นทางของเรื่องชายชาวสวีเดนสวมขาเทียมคือโพสต์ใด และเผยแพร่เมื่อใด', why_valuable: 'ยืนยันเรื่องหลักและป้องกันนำข่าวเก่ามาเล่าเป็นข่าวปัจจุบัน', decided: 'ค้น', reason: 'ข่าวดิบไม่มีลิงก์ ชื่อผู้โพสต์ หรือวันเกิดเหตุ' },
  { question: 'มีหลักฐานรองรับสัญชาติ การสวมขาเทียม และคำพูดท้ายข่าวหรือไม่', why_valuable: 'ป้องกันระบุสัญชาติและอ้างคำพูดผิดคน', decided: 'ค้น', reason: 'เป็นองค์ประกอบสำคัญของข่าว แต่ยังไม่มีแหล่งอ้างอิง' },
  { question: 'ชายคนนี้มีประวัติส่วนตัวหรือสาเหตุการสูญเสียขาอย่างไร', why_valuable: 'ไม่ได้ช่วยยืนยันเหตุการณ์ที่รายงาน', decided: 'ไม่ค้น', reason: 'เป็นข้อมูลส่วนตัวของคนธรรมดาและไม่จำเป็นต่อข่าว' },
];

export function agentResultOut1() {
  return {
    status: 'done',
    brain: { kind: 'codex', model: 'gpt-6-astra', effort: 'low', account: 'main', quotaPctAfter: 72 },
    plan: OUT1_PLAN.map((p) => ({ ...p })),
    origin_post: { url: 'ไม่พบ', source_name: 'ไม่พบต้นทางที่ตรงกับเรื่องชายชาวสวีเดน', date: 'ไม่ทราบ', confidence: 0 },
    story_date_estimate: 'ไม่ทราบ',
    stale_news_warning: 'ยังตรวจไม่ได้ว่าเป็นข่าวเก่าเล่าใหม่หรือไม่: ไม่พบต้นทางเรื่องชายชาวสวีเดนและวันที่เผยแพร่',
    cards: [{
      id: 'R1',
      claim: 'เพจตาเป้มีโพสต์ขอแรงช่วยกรอกกระสอบทรายกั้นน้ำที่เขื่อนเทศบาลเมืองราชบุรี แต่ข้อความที่ดึงได้ยังไม่เชื่อมโยงกับชายชาวสวีเดนในข่าวดิบ',
      value_type: 'อื่นๆ',
      why_it_adds_value: 'เป็นหลักฐานบริบทในพื้นที่เท่านั้น ไม่ใช้ยืนยันสัญชาติ ขาเทียม วันเกิดเหตุ หรือคำพูดของชายในข่าว',
      evidence_quote: 'ขอแรงช่วยกรอกกระสอบทราย กั้นน้ำที่เขื่อนเทศบาลเมืองราชบุรี เวลานี้ครับ',
      source_url: 'https://www.facebook.com/tapeanews/posts/1649392430310047/',
      source_name: 'ตาเป้ (Facebook)',
      source_date: 'ไม่ทราบวันเผยแพร่แน่นอน',
      confidence: 0.95,
      contradicts_raw: false,
      identity: 'generic',
      gate: 'pass',
    }],
    raw_corrections: [],
    flags: ['ORIGIN_NOT_FOUND'],
    skipped: ['ไม่ค้นชื่อจริง ที่อยู่ ครอบครัว หรือประวัติสุขภาพของชายในข่าว เพราะไม่จำเป็นต่อการตรวจเหตุการณ์'],
    tool_log: [
      { tool: 'exec_command / serper', args: 'node tools/serper.mjs ชาวสวีเดน ขาเทียม ราชบุรี กระสอบทราย --num 6', ok: true, note: 'พบลิงก์เพจตาเป้และเทศบาล', ms: 1200 },
      { tool: 'exec_command / fetch-page', args: 'node tools/fetch-page.mjs https://www.facebook.com/tapeanews/posts/1649392430310047/ --max 6000', ok: true, note: 'ดึงเนื้อโพสต์ได้', ms: 9000 },
    ],
    usage: { tool_calls: 12, minutes: 2.75, costUsd: 0.004 },
  };
}

const IG_DARA = 'https://www.facebook.com/IG.dara/posts/pfbid02xtmH9UpCU2yNs9dKTV6R9ZgeQyrXm7EU97zBkZ64t9MrSAXTe4jxBsyzLoiaKK1el';

export function agentResultOut2() {
  return {
    status: 'done',
    brain: { kind: 'codex', model: 'gpt-6-astra', effort: 'low', account: 'b', quotaPctAfter: 12 },
    plan: [{ question: 'ใครเป็นผู้โพสต์ต้นฉบับและเผยแพร่เมื่อใด', why_valuable: 'ตรวจคำอ้างบุคคล สถานที่ และข่าวเก่า', decided: 'ค้น', reason: 'ข่าวดิบไม่มีชื่อผู้เล่าหรือ URL จึงให้ความสำคัญสูงสุด' }],
    origin_post: { url: IG_DARA, source_name: 'รวมไอจีดารา', date: '2026-10-01T05:51:22.000Z', confidence: 0.4 },
    story_date_estimate: 'ไม่ทราบ',
    stale_news_warning: null,
    cards: [
      {
        id: 'R1',
        claim: 'พบโพสต์เพจรวมไอจีดาราที่เล่าเรื่องเดียวกัน แต่เผยแพร่หลังเวลาส่งข่าวดิบ จึงใช้เป็นต้นทางเดิมไม่ได้',
        value_type: 'ต้นทาง',
        why_it_adds_value: 'แยกโพสต์เผยแพร่ซ้ำออกจากพยานต้นทาง',
        evidence_quote: 'สาวรายหนึ่งได้เจอเขาทำงานอยู่ตรงนั้น แล้วนำเรื่องนี้มาเล่าต่อ',
        source_url: IG_DARA, source_name: 'รวมไอจีดารา / Facebook', source_date: '2026-10-01T05:51:22.000Z',
        confidence: 0.99, contradicts_raw: false, identity: 'generic', gate: 'pass',
      },
      {
        id: 'R2',
        claim: 'โพสต์เผยแพร่ซ้ำที่ตรวจได้มียอดแชร์ 1 ครั้งและแสดง 2 ความคิดเห็น ณ เวลาตรวจ ไม่ใช่ยอดของโพสต์ต้นฉบับ',
        value_type: 'ตัวเลข-บริบท',
        why_it_adds_value: 'มีตัวเลขตรวจสอบได้โดยไม่อ้างว่าข่าวแพร่หลายมากจากคำว่าไวรัล',
        evidence_quote: '2 comments\n1 share',
        source_url: IG_DARA, source_name: 'รวมไอจีดารา / Facebook', source_date: '2026-10-01T05:51:22.000Z',
        confidence: 0.99, contradicts_raw: false, identity: 'generic', gate: 'pass',
      },
      {
        id: 'R3',
        claim: 'ในความคิดเห็นที่หน้าโพสต์แสดง ไม่พบข้อมูลความคืบหน้าหรือแก้ข่าว โดยเพจทวนเนื้อหาเดิมและตอบขอบคุณความคิดเห็น',
        value_type: 'ความคืบหน้า',
        why_it_adds_value: 'บอกขอบเขตการตรวจจริง',
        evidence_quote: 'Thx for comment',
        source_url: IG_DARA, source_name: 'รวมไอจีดารา / Facebook ความคิดเห็นที่แสดง', source_date: '2026-10-01',
        confidence: 0.95, contradicts_raw: false, identity: 'generic', gate: 'pass',
      },
    ],
    raw_corrections: [],
    flags: ['ORIGIN_NOT_FOUND', 'QUOTA_LOW'],
    skipped: ['ไม่พบหลักฐานขัดข่าวดิบโดยตรง'],
    tool_log: [{ tool: 'exec_command / apify', args: 'node tools/apify.mjs facebook-posts --input in.json', ok: true, note: 'ดึงโพสต์ที่รู้ URL ได้', ms: 30000 }],
    usage: { tool_calls: 25, minutes: 4.86, costUsd: 0.02 },
  };
}

/** การ์ดที่ผ่านทุกด่านฝั่งเว็บ (ใช้สร้างชุดเกิน 8 ใบ) */
export function passingCard(index, confidence = 0.9) {
  return {
    id: `R${index}`,
    claim: `เทศบาลเมืองราชบุรีแจกกระสอบทราย ${1000 + index} ใบ ให้ชาวบ้านริมแม่น้ำแม่กลอง`,
    value_type: 'ตัวเลข-บริบท',
    why_it_adds_value: 'เห็นขนาดของงานช่วยเหลือ',
    evidence_quote: `เทศบาลเมืองราชบุรีเตรียมกระสอบทราย ${1000 + index} ใบ แจกจ่ายให้ประชาชนริมแม่น้ำแม่กลอง`,
    source_url: `https://news.example.test/ratchaburi/${index}`,
    source_name: 'ข่าวท้องถิ่น',
    source_date: '2026-09-30',
    confidence,
    contradicts_raw: false,
    identity: 'generic',
    gate: 'pass',
  };
}
