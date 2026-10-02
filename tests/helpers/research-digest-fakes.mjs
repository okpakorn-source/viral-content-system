// ============================================================
// 🧪 tests/helpers/research-digest-fakes.mjs — ของปลอมร่วมของเทสตัวเฝ้า/สรุปรายวัน
// ★ 2 ต.ค. 69 (เฝ้า worker + สรุปรายวัน · SPEC-v3 ส่วน 12 · W7)
// ------------------------------------------------------------
// 1) createTableSupabase(): Supabase ปลอมหลายตาราง (generation_logs · store_items · api_usage_logs) ในหน่วยความจำ
//    select (ตัดคอลัมน์ตามที่ขอจริง — พิสูจน์ว่า route ไม่ได้ดึงเนื้อข่าว) · eq/gte/lt (รวม 'data->>field') · order · limit · range
//    · maybeSingle · abortSignal (เก็บไว้ตรวจว่าถูกยกเลิกหลังหมดเวลา) · insert (ชน id = 23505) / update (+select)
//    failNext(table, {mode}) = คำสั่งถัดไปของตารางนั้นล้ม: 'error' (คืน {error}) | 'throw' | 'hang' (ไม่ตอบเลย)
//    ไม่ต่อเน็ต ไม่เขียนไฟล์ · ข้อความ error ปลอมมีคำว่า SECRET (เทสตรวจว่าไม่หลุดออกไปในคำตอบ)
// 2) digestFixture(): แถวตัวอย่างช่วง 20 ก.ย. 69 07:30 → 21 ก.ย. 69 07:30 (เวลาไทย) ทั้งในและนอกช่วง + DIGEST_EXPECTED (ตัวเลขที่ถูก)
//    ช่วงอยู่ในอดีตเสมอ (route ตรวจ until ≤ ตอนนี้ + 10 นาทีด้วยนาฬิกาจริง)
// ============================================================

export const DIGEST_SINCE = '2026-09-20T00:30:00.000Z';
export const DIGEST_UNTIL = '2026-09-21T00:30:00.000Z';
/** ข้อความที่อยู่ในเนื้อข่าว/เวอร์ชันของแถว generation_logs ปลอม — ต้องไม่โผล่ในคำตอบ route (ไม่คืนเนื้อข่าว) */
export const NEWS_BODY_SENTINEL = 'SENTINEL_NEWS_BODY_ห้ามหลุด';

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

export function createTableSupabase() {
  const tables = new Map();
  const calls = [];
  const failures = [];
  const signals = [];
  const deferred = [];
  const rowsOf = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
  };
  const valueAt = (row, column) => {
    const m = /^data->>(\w+)$/.exec(column);
    if (m) {
      const value = row.data?.[m[1]];
      if (value === undefined || value === null) return null;
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    return row[column] ?? null;
  };
  const compare = (a, b) => {
    const ta = typeof a === 'string' ? Date.parse(a) : Number.NaN;
    const tb = typeof b === 'string' ? Date.parse(b) : Number.NaN;
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  };
  const matches = (row, filters) => filters.every(([op, column, expected]) => {
    const actual = valueAt(row, column);
    if (op === 'eq') return actual === null ? expected === null : String(actual) === String(expected);
    if (actual === null) return false;
    const c = compare(actual, expected);
    return op === 'gte' ? c >= 0 : c < 0;
  });
  const project = (row, cols) => {
    if (!cols || cols === '*') return clone(row);
    const out = {};
    for (const col of String(cols).split(',').map((c) => c.trim()).filter(Boolean)) out[col] = clone(row[col] ?? null);
    return out;
  };

  function execute(st) {
    calls.push({ table: st.table, op: st.op, cols: st.cols, filters: clone(st.filters), order: clone(st.order), limit: st.limit, range: clone(st.range) });
    if (st.signal) signals.push({ table: st.table, signal: st.signal });
    const index = failures.findIndex((f) => f.table === st.table && (!f.op || f.op === st.op));
    if (index >= 0 && failures[index].after > 0) {
      failures[index].after -= 1; // ปล่อยผ่านก่อน n ครั้ง (เช่น ให้หน้าแรกผ่าน หน้าที่ 2 ล้ม)
      return executeNow(st);
    }
    if (index >= 0) {
      const failure = failures[index];
      failure.count -= 1;
      if (failure.count <= 0) failures.splice(index, 1);
      if (failure.mode === 'throw') throw new Error('SECRET transport failure detail');
      if (failure.mode === 'hang') return new Promise(() => {});
      if (failure.mode === 'defer') {
        // ตอบช้า: ได้ผลจริงเมื่อเทสสั่ง release() (จำลองหน้าที่ตอบหลังหมดเวลา)
        const result = executeNow(st);
        return new Promise((resolve) => { deferred.push({ table: st.table, range: clone(st.range), release: () => resolve(result) }); });
      }
      return { data: null, error: { message: 'SECRET database detail', code: 'XX000' } };
    }
    return executeNow(st);
  }

  function executeNow(st) {
    const rows = rowsOf(st.table);
    if (st.op === 'insert') {
      const list = Array.isArray(st.payload) ? st.payload : [st.payload];
      for (const row of list) {
        if (rows.some((r) => r.id === row.id)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      for (const row of list) rows.push(clone(row));
      return { data: st.returning ? list.map((r) => ({ id: r.id })) : null, error: null };
    }
    if (st.op === 'update') {
      const hit = rows.filter((row) => matches(row, st.filters));
      for (const row of hit) Object.assign(row, clone(st.payload));
      return { data: st.returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    let list = rows.filter((row) => matches(row, st.filters));
    for (const [column, asc] of [...st.order].reverse()) list = [...list].sort((a, b) => compare(a[column], b[column]) * (asc ? 1 : -1));
    if (st.range) list = list.slice(st.range[0], st.range[1] + 1);
    if (Number.isInteger(st.limit)) list = list.slice(0, st.limit);
    const shaped = list.map((row) => project(row, st.cols));
    if (st.single) return { data: shaped[0] ?? null, error: null };
    return { data: shaped, error: null };
  }

  function builder(table) {
    const st = { table, op: 'select', cols: '*', filters: [], order: [], limit: null, range: null, single: false, payload: null, returning: false, signal: null };
    const api = {
      select(cols) { if (st.op === 'select') st.cols = cols; else st.returning = true; return api; },
      eq(column, value) { st.filters.push(['eq', column, value]); return api; },
      gte(column, value) { st.filters.push(['gte', column, value]); return api; },
      lt(column, value) { st.filters.push(['lt', column, value]); return api; },
      order(column, opts = {}) { st.order.push([column, opts.ascending !== false]); return api; },
      limit(n) { st.limit = n; return api; },
      range(from, to) { st.range = [from, to]; return api; },
      maybeSingle() { st.single = true; return api; },
      abortSignal(signal) { st.signal = signal; return api; },
      insert(payload) { st.op = 'insert'; st.payload = payload; return api; },
      update(payload) { st.op = 'update'; st.payload = payload; return api; },
      then(resolve, reject) { return Promise.resolve().then(() => execute(st)).then(resolve, reject); },
    };
    return api;
  }

  return {
    from: (table) => builder(table),
    calls,
    signals,
    deferred,
    rowsOf,
    /** เติมแถว (clone) */
    insertRows(table, rows) { for (const row of rows) rowsOf(table).push(clone(row)); },
    /**
     * คำสั่งถัดไปของตารางนี้ล้ม · mode: 'error' | 'throw' | 'hang' | 'defer' (ตอบเมื่อเรียก deferred[i].release())
     * op: จำกัดเฉพาะ select/insert/update · after: ปล่อยผ่านก่อนกี่ครั้ง (0 = ล้มครั้งถัดไปเลย)
     */
    failNext(table, { count = 1, mode = 'error', op = null, after = 0 } = {}) { failures.push({ table, count, mode, op, after }); },
  };
}

// ── ข้อมูลตัวอย่าง (ช่วง DIGEST_SINCE → DIGEST_UNTIL) ───────────────────
const SINCE_MS = Date.parse(DIGEST_SINCE);
const UNTIL_MS = Date.parse(DIGEST_UNTIL);
/** เวลา h ชั่วโมง m นาทีหลัง since (ISO) */
export const atHour = (h, m = 0) => new Date(SINCE_MS + (h * 60 + m) * 60_000).toISOString();
const beforeSince = (minutes) => new Date(SINCE_MS - minutes * 60_000).toISOString();
const afterUntil = (minutes) => new Date(UNTIL_MS + minutes * 60_000).toISOString();

const LONG_TITLE = `เนย-แจม สามพี่น้องช่วยกันผ่อนบ้านให้แม่ ${'ยาวมาก'.repeat(30)}`;

function genRow(caseId, createdAt, pipelineInfo, title) {
  return {
    case_id: caseId,
    news_title: title,
    created_at: createdAt,
    source_type: 'discord',
    source_text: `${NEWS_BODY_SENTINEL} เนื้อข่าวเต็มของเคส ${caseId}`,
    versions: [{ content: `${NEWS_BODY_SENTINEL} เวอร์ชัน 1` }],
    pipeline_info: pipelineInfo,
  };
}

function cardRow(jobId, createdAt, updatedAt, data, storeName = 'research-cards') {
  return {
    id: `rcard_${jobId}`,
    store_name: storeName,
    created_at: createdAt,
    updated_at: updatedAt,
    data: { id: jobId, revision: 2, mode: 'write', plan: [], cards: [], raw_corrections: [], tool_log: [{ tool: 'serper', args: NEWS_BODY_SENTINEL }], ...data },
  };
}

function usageRows() {
  const rows = [];
  for (let i = 0; i < 2000; i += 1) rows.push({ provider: 'anthropic', model: 'claude-opus-5-5', cost_usd: 0.001, feature: 'callClaude', created_at: new Date(SINCE_MS + 1000 + i * 30_000).toISOString() });
  for (let i = 0; i < 345; i += 1) rows.push({ provider: 'openai', model: 'gpt-5.6-sol', cost_usd: 0.01, feature: 'autoFlow', created_at: new Date(SINCE_MS + 2000 + i * 60_000).toISOString() });
  rows.push({ provider: 'google', model: 'gemini-3.6-flash', cost_usd: '0.5', feature: 'imageSearch', created_at: atHour(12) });
  rows.push({ provider: 'openai', model: 'x', cost_usd: null, feature: null, created_at: atHour(13) });
  for (let i = 0; i < 10; i += 1) rows.push({ provider: 'openai', model: 'x', cost_usd: 1, feature: 'นอกช่วง', created_at: beforeSince(5 + i) });
  rows.push({ provider: 'openai', model: 'x', cost_usd: 1, feature: 'นอกช่วง', created_at: DIGEST_UNTIL }); // until เอง = นอกช่วง (lt)
  return rows;
}

/** แถวตัวอย่างทุกตาราง (ใหม่ทุกครั้ง) */
export function digestFixture() {
  return {
    generation_logs: [
      genRow('06501', atHour(1), { totalTime: 480, jobId: 'q_digest_a', researchAgent: { status: 'done', mode: 'write', cardsCount: 3, flags: ['STALE_NEWS'], editor: { status: 'done', used: 2, corrections: 2, additions: 3, ratio: 1.5, waitedMs: 40000, editorMs: 20000 } } }, LONG_TITLE),
      genRow('06502', atHour(2), { totalTime: 520, jobId: 'q_digest_b', researchAgent: { status: 'pending', mode: 'write', cardsCount: 0, flags: [], editor: { status: 'not_ready', used: 0, corrections: 0, additions: 0, ratio: null, waitedMs: 300000, editorMs: null } } }, 'พยาบาล ICU'),
      genRow('06503', atHour(3), { totalTime: 400, jobId: 'q_digest_c', researchAgent: { status: 'failed', mode: 'write', cardsCount: 0, flags: ['ENCODING_BROKEN', 'AGENT_FAILED'], editor: { status: 'skipped', used: 0, corrections: 0, additions: 0, ratio: null, waitedMs: 60000, editorMs: null } } }, 'ชาวสวีเดน'),
      genRow('06504', atHour(4), { totalTime: 450, jobId: 'q_digest_d', researchAgent: { status: 'done', mode: 'write', cardsCount: 2, flags: [], editor: { status: 'failed', used: 0, corrections: 0, additions: 0, ratio: null, waitedMs: 50000, editorMs: 61000 } } }, 'ข่าว D'),
      genRow('06505', atHour(5), { totalTime: 300, jobId: 'q_digest_e', researchAgent: { status: 'done', mode: 'assist', cardsCount: 1, flags: [], waitedMs: 90000 } }, 'ข่าว E'),
      genRow('06506', atHour(6), { totalTime: 200 }, 'ข่าว F ไม่ผ่านระบบใหม่'),
      genRow('06507', atHour(7), { totalTime: 250, jobId: 'q_digest_g', researchAgent: { status: 'pending', mode: 'shadow', cardsCount: 0, flags: [], waitedMs: 0 } }, 'ข่าว G'),
      genRow('06490', beforeSince(1), { totalTime: 999, jobId: 'q_digest_out1', researchAgent: { status: 'done', mode: 'write', flags: [], editor: { status: 'done', corrections: 9, additions: 9 } } }, 'นอกช่วงก่อน'),
      genRow('06510', DIGEST_UNTIL, { totalTime: 999, jobId: 'q_digest_out2', researchAgent: { status: 'done', mode: 'write', flags: [], editor: { status: 'done', corrections: 9, additions: 9 } } }, 'นอกช่วงหลัง'),
    ],
    store_items: [
      cardRow('q_digest_a', atHour(1, 3), atHour(9), { status: 'done', flags: ['STALE_NEWS', 'RAW_CONTRADICTION'], usage: { tool_calls: 12, minutes: 3.5, costUsd: 0.02 },
        feedback: [{ userId: 'discord-1', cardId: 'all', vote: 'up', at: atHour(2) }, { userId: 'discord-2', cardId: 'all', vote: 'down', at: atHour(3), kind: 'editor' }] }),
      cardRow('q_digest_b', atHour(2, 3), atHour(10), { status: 'done', flags: ['ORIGIN_NOT_FOUND'], usage: { tool_calls: 20, minutes: 4.5, costUsd: 0.01 },
        feedback: [{ userId: 'discord-1', cardId: 'all', vote: 'down', at: atHour(4) }] }),
      cardRow('q_digest_c', atHour(3, 3), atHour(3, 3), { status: 'failed', flags: ['ENCODING_BROKEN', 'AGENT_FAILED'], usage: { tool_calls: 25, minutes: 6, costUsd: 0 }, feedback: [] }),
      cardRow('q_digest_old', beforeSince(2 * 24 * 60), atHour(5), { status: 'done', flags: ['STALE_NEWS'], usage: { tool_calls: 99, minutes: 9, costUsd: 9 },
        feedback: [{ userId: 'discord-3', cardId: 'all', vote: 'down', at: atHour(5) }, { userId: 'discord-4', cardId: 'all', vote: 'up', at: beforeSince(60) }] }),
      cardRow('q_digest_vote_late', atHour(8), afterUntil(120), { status: 'skipped', flags: [], usage: { tool_calls: 0, minutes: 0.5, costUsd: 0 },
        feedback: [{ userId: 'discord-5', cardId: 'all', vote: 'up', at: afterUntil(120) }] }),
      cardRow('q_digest_late', afterUntil(60), afterUntil(60), { status: 'done', flags: ['STALE_NEWS'], usage: { tool_calls: 5, minutes: 1, costUsd: 5 }, feedback: [] }),
      cardRow('q_digest_other_store', atHour(6), atHour(6), { status: 'done', flags: ['STALE_NEWS'], usage: { tool_calls: 5, minutes: 1, costUsd: 5 } }, 'research-requests'),
    ],
    api_usage_logs: usageRows(),
  };
}

/** ตัวเลขที่ถูกของ digestFixture() — ไล่มือจากแถวด้านบน (ไม่ได้คำนวณด้วยโค้ดที่ทดสอบ) */
export const DIGEST_EXPECTED = Object.freeze({
  news: {
    total: 7,
    capped: false,
    withAgent: 6,
    modes: { shadow: 1, assist: 1, write: 4, other: 0 },
    agentStatus: { done: 3, failed: 1, pending: 2 },
    editor: { done: 1, not_ready: 1, skipped: 1, failed: 1 },
    encodingBroken: 1,
    corrections: 2,
    additions: 3,
    avgWaitMs: 108000, // (40000 + 300000 + 60000 + 50000 + 90000[assist]) / 5
    avgEditorMs: 40500, // (20000 + 61000) / 2
    avgTotalSec: 371.4, // (480+520+400+450+300+200+250) / 7
  },
  cards: {
    total: 4,
    capped: false,
    status: { done: 2, failed: 1, skipped: 1, other: 0 },
    flags: { AGENT_FAILED: 1, ENCODING_BROKEN: 1, ORIGIN_NOT_FOUND: 1, RAW_CONTRADICTION: 1, STALE_NEWS: 1 },
    toolCostUsd: 0.03,
    minutes: 14.5,
    avgMinutes: 3.6, // 14.5 / 4 = 3.625
    toolCalls: 57,
    votes: {
      first: { up: 1, down: 2 },
      second: { up: 0, down: 1 },
      downJobs: [{ jobId: 'q_digest_a', down: 1 }, { jobId: 'q_digest_b', down: 1 }, { jobId: 'q_digest_old', down: 1 }],
    },
  },
  aiCost: {
    usd: 5.95,
    calls: 2347,
    capped: false,
    byFeature: [
      { feature: 'autoFlow', usd: 3.45, calls: 345 },
      { feature: 'callClaude', usd: 2, calls: 2000 },
      { feature: 'imageSearch', usd: 0.5, calls: 1 },
      { feature: '?', usd: 0, calls: 1 },
    ],
  },
  watchJobIds: ['q_digest_a', 'q_digest_b', 'q_digest_old'],
});
