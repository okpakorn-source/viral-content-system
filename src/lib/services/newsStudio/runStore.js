/**
 * =====================================================
 * News Studio — รูปข้อมูลของ "งานเขียน 1 งาน" ที่เก็บลงคลังประวัติ (10 พ.ย. 69)
 * =====================================================
 * ฟังก์ชันล้วน ไม่แตะฐานข้อมูลเอง — ตัวเก็บจริง (persistStore) ถูกต่อที่ server.js
 * หลัก:
 *   - เก็บให้ "เล็ก": ไม่เก็บโพสต์ครูฉบับเต็มซ้ำทุกงาน (เก็บรหัสครู หน้าเว็บไปดึงจากคลังครูเอง) — คลังประวัติถูกอ่านทั้งก้อนทุกครั้ง
 *   - งานที่ยังไม่จบ / ล้ม ก็เก็บ (สถานะ running / failed) — หน้าจอหลุดกลางทางแล้วกลับมาดูได้ และงานล้มไม่หายเงียบ
 */

export const RUN_LIMITS = Object.freeze({
  maxRuns: 100,          // เกินนี้ลบงานเก่าสุดออก (คลังถูกอ่านทั้งก้อน 1 ครั้งต่องาน — ต้องมีเพดาน)
  staleRunningMs: 12 * 60 * 1000, // งานค้างสถานะ running นานกว่านี้ = ระบบหยุดกลางทาง
  recentTeacherRuns: 10, // เลี่ยงครูที่ใช้ใน 10 งานล่าสุด (≈ 30 โพสต์ — ค่าเดียวกับชุดทดลอง)
  noteMax: 500,
});

export const REVIEW_STATUSES = Object.freeze(['unreviewed', 'good', 'bad', 'used']);

/** รหัสงาน — ขึ้นต้น ns_ เพราะตาราง store_items ใช้ id ร่วมกันทุกคลัง */
export function newRunId(now = Date.now(), rand = Math.random()) {
  return `ns_${now}_${Math.floor(rand * 1e8).toString(36).padStart(5, '0')}`;
}

export function isRunId(id) {
  return /^ns_\d{10,16}_[a-z0-9]{1,8}$/.test(String(id || ''));
}

const str = (v, max) => String(v ?? '').slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);

function compactAngle(a) {
  if (!a) return null;
  return {
    core: str(a.core, 400), focus: str(a.focus, 400), why: str(a.why, 400),
    coverLines: arr(a.coverLines).map((x) => str(x, 200)).slice(0, 4),
    order: arr(a.order).map((x) => str(x, 240)).slice(0, 6),
    mustKeep: arr(a.mustKeep).map((x) => str(x, 200)).slice(0, 6),
    exemplarIds: arr(a.exemplarIds).map((x) => str(x, 12)).slice(0, 4),
  };
}

function compactVersion(v) {
  const t = v.teacher || {};
  return {
    index: v.index, ok: !!v.ok, content: str(v.content, 6000), attempts: v.attempts || 0, stopped: str(v.stopped, 200),
    trail: arr(v.trail).slice(0, 3).map((x) => ({ attempt: x.attempt, fails: arr(x.fails).slice(0, 12), factMajor: x.factMajor || 0, factChecked: x.factChecked ?? null, readerClear: x.readerClear ?? null })),
    angle: compactAngle(v.angle),
    teacher: { id: str(t.id, 60), name: str(t.name, 200), category: str(t.category, 60), views: Number(t.views) || 0, url: str(t.url, 300), openingType: str(t.openingType, 20), reason: str(t.reason, 240) },
    formOk: !!v.formOk,
    fails: arr(v.fails).slice(0, 12).map((f) => ({ code: str(f.code, 40), message: str(f.message, 500) })),
    warns: arr(v.warns).slice(0, 12).map((f) => ({ code: str(f.code, 40), message: str(f.message, 300) })),
    metrics: v.metrics ? { words: v.metrics.words, paragraphs: v.metrics.paragraphs, chars: v.metrics.chars, charLimit: v.metrics.charLimit, paragraphChars: arr(v.metrics.paragraphChars).slice(0, 6), rawCopyPct: v.metrics.rawCopyPct, rawRun: v.metrics.rawRun } : null,
    factChecked: !!v.factChecked,
    factIssues: arr(v.factIssues).slice(0, 8).map((i) => ({ type: str(i.type, 12), severity: str(i.severity, 8), quote: str(i.quote, 240), problem: str(i.problem, 300), fix: str(i.fix, 300) })),
    factError: str(v.factError, 200),
    readChecked: !!v.readChecked, readClear: !!v.readClear, readOpening: str(v.readOpening, 20), readGist: str(v.readGist, 300),
    readHardParts: arr(v.readHardParts).slice(0, 3).map((h) => ({ quote: str(h.quote, 200), kind: str(h.kind, 20), why: str(h.why, 200) })),
    readError: str(v.readError, 200),
    ...(v.error ? { error: str(v.error, 240), errorType: str(v.errorType, 40) } : {}),
  };
}

const userOf = (user) => ({ username: str(user?.username, 60), displayName: str(user?.displayName || user?.username, 80) });
const blankReview = () => ({ status: 'unreviewed', note: '', pickedVersion: null, by: '', at: '' });

/** แถวตอนเริ่มงาน (ยังไม่มีผล) */
export function startedRun({ id, rawText, useResearch, user, createdAt, source = 'studio' }) {
  const raw = String(rawText || '');
  return {
    id, status: 'running', createdAt, finishedAt: '', user: userOf(user), source: source === 'discord' ? 'discord' : 'studio', caseId: '',
    title: raw.trim().split('\n')[0].slice(0, 80), rawText: str(raw, 20000), useResearch: !!useResearch,
    progress: [], review: blankReview(),
  };
}

/** แถวตอนงานจบ — result = ผลของ runNewsStudio */
export function finishedRun(row, { result, models, finishedAt }) {
  return {
    ...row, status: 'done', finishedAt,
    title: str(result.title, 120) || row.title,
    analysis: result.analysis ? { primaryCategory: str(result.analysis.primaryCategory, 60), emotionalTags: arr(result.analysis.emotionalTags).map((x) => str(x, 30)).slice(0, 6) } : null,
    direction: { ok: !!result.direction?.ok, error: str(result.direction?.error, 240), angles: arr(result.direction?.angles).slice(0, 3).map(compactAngle) },
    researchFacts: arr(result.researchFacts).map((x) => str(x, 400)).slice(0, 8),
    versions: arr(result.versions).map(compactVersion),
    summary: result.summary || null,
    warnings: arr(result.warnings).slice(0, 12).map((w) => ({ code: str(w.code, 40), message: str(w.message, 300) })),
    timings: result.timings || null,
    models: models || null,
  };
}

export function failedRun(row, { error, errorType, finishedAt }) {
  return { ...row, status: 'failed', finishedAt, error: str(error, 400), errorType: str(errorType || 'NEWS_STUDIO_FAILED', 60) };
}

/** สถานะที่แสดงผล: งาน running ที่ค้างนานเกิน = stale (ระบบหยุดกลางทาง ไม่ใช่กำลังทำ) */
export function effectiveStatus(run, now = Date.now()) {
  if (run?.status !== 'running') return run?.status || 'unknown';
  const started = Date.parse(run.createdAt || '');
  return Number.isFinite(started) && now - started > RUN_LIMITS.staleRunningMs ? 'stale' : 'running';
}

/** แถวย่อสำหรับหน้ารายการ (ไม่ส่งเนื้อข่าว/เวอร์ชันเต็ม) */
export function listRow(run, now = Date.now()) {
  const versions = arr(run.versions);
  return {
    id: run.id, status: effectiveStatus(run, now), createdAt: run.createdAt, finishedAt: run.finishedAt || '',
    title: run.title || '', user: run.user || userOf(null), source: run.source === 'discord' ? 'discord' : 'studio', caseId: run.caseId || '',
    rawChars: String(run.rawText || '').length,
    category: run.analysis?.primaryCategory || '',
    summary: run.summary || null,
    seconds: run.timings?.total ? Math.round(run.timings.total / 1000) : null,
    coverLines: arr(versions[0]?.angle?.coverLines),
    directionOk: run.direction ? !!run.direction.ok : null,
    warningCodes: arr(run.warnings).map((w) => w.code),
    error: run.error || '',
    review: run.review || blankReview(),
  };
}

/** ตรวจคำขอรีวิว — คืน patch ที่ใช้ได้ หรือเหตุที่ใช้ไม่ได้ (ไม่เดาแทนผู้ใช้) */
export function validateReview(body, { versionCount = 3, user, now = new Date().toISOString() } = {}) {
  const status = String(body?.status ?? '').trim();
  if (!REVIEW_STATUSES.includes(status)) return { ok: false, error: `สถานะรีวิวต้องเป็นหนึ่งใน: ${REVIEW_STATUSES.join(', ')}`, errorType: 'BAD_REVIEW_STATUS' };
  let pickedVersion = null;
  if (body?.pickedVersion !== undefined && body?.pickedVersion !== null && body?.pickedVersion !== '') {
    const n = Number(body.pickedVersion);
    if (!Number.isInteger(n) || n < 1 || n > versionCount) return { ok: false, error: `เวอร์ชันที่เลือกต้องเป็นเลข 1–${versionCount}`, errorType: 'BAD_PICKED_VERSION' };
    pickedVersion = n;
  }
  if (status === 'used' && pickedVersion === null) return { ok: false, error: 'ถ้าจะบันทึกว่า "นำไปใช้แล้ว" ต้องบอกว่าใช้เวอร์ชันไหน', errorType: 'PICKED_VERSION_REQUIRED' };
  return { ok: true, review: { status, note: String(body?.note ?? '').trim().slice(0, RUN_LIMITS.noteMax), pickedVersion, by: userOf(user).displayName, at: now } };
}

/**
 * รวมคำขอรีวิวเข้ากับผลรีวิวที่เก็บอยู่ "ตอนบันทึก" — คำขอส่งมาเฉพาะช่องที่ผู้ใช้เปลี่ยน
 * (เดิมหน้าเว็บส่งทั้งก้อนจากสถานะบนจอ: จอที่ค้างค่าเก่ากดบันทึกหมายเหตุ = ทับสถานะ/เวอร์ชันที่อีกคนเพิ่งบันทึก)
 * เวอร์ชันที่เลือกมีความหมายเฉพาะสถานะ "นำไปใช้แล้ว" — เปลี่ยนเป็นสถานะอื่นโดยไม่ระบุ = ล้างทิ้ง
 */
export function mergeReview(current, body, opts = {}) {
  const cur = current && typeof current === 'object' ? current : blankReview();
  const has = (k) => body && Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
  if (!body || typeof body !== 'object' || !['status', 'note', 'pickedVersion'].some(has)) return { ok: false, error: 'คำขอรีวิวไม่มีช่องที่จะบันทึก (status, pickedVersion หรือ note)', errorType: 'EMPTY_REVIEW' };
  const status = has('status') ? body.status : (cur.status || 'unreviewed');
  let pickedVersion = has('pickedVersion') ? body.pickedVersion : cur.pickedVersion;
  if (String(status) !== 'used' && !has('pickedVersion')) pickedVersion = null;
  return validateReview({ status, pickedVersion, note: has('note') ? body.note : cur.note }, opts);
}

/**
 * ตัวเลขสำหรับด่านโควตา — นับจากคลังประวัติ (ใช้ร่วมกันทุกเครื่อง) ไม่ใช่ตัวนับในหน่วยความจำของเครื่องเดียว
 */
export function quotaState(runs, { username = '', now = Date.now() } = {}) {
  // โควตานับเฉพาะงานที่สั่งจากหน้าสตูดิโอ — งานจากท่อ Discord มีคิวของตัวเองคุมอยู่แล้ว และต้องไม่กินโควตาของหน้าเว็บ
  const list = arr(runs).filter((r) => r?.source !== 'discord');
  const since = (ms) => list.filter((r) => { const t = Date.parse(r?.createdAt || ''); return Number.isFinite(t) && now - t < ms; });
  const hour = since(60 * 60 * 1000);
  return {
    running: list.filter((r) => effectiveStatus(r, now) === 'running').length,
    hourAll: hour.length,
    hourUser: username ? hour.filter((r) => r?.user?.username === username).length : 0,
    dayAll: since(24 * 60 * 60 * 1000).length,
  };
}

/** รหัสครูที่ใช้ในงานล่าสุด (ใหม่สุดก่อน) — ให้ตัวเลือกครูเลี่ยงใบซ้ำ */
export function recentTeacherIds(runs, limit = RUN_LIMITS.recentTeacherRuns) {
  const sorted = [...arr(runs)].filter((r) => r?.status === 'done').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const out = [];
  for (const r of sorted.slice(0, limit)) for (const v of arr(r.versions)) if (v?.teacher?.id && !out.includes(v.teacher.id)) out.push(v.teacher.id);
  return out;
}

/** แถวเล็กที่จำครูที่เพิ่งใช้ (รหัสไม่ตรงรูปของรหัสงาน จึงไม่ปนกับรายการงาน) — อ่าน/เขียนแถวเดียว ไม่ต้องอ่านคลังทั้งก้อนทุกงาน */
export const RECENT_ROW_ID = 'nsmeta_recent_teachers';
export const RECENT_TEACHER_CAP = 30;

/** รวมครูที่เพิ่งใช้เข้ากับของเดิม: ใหม่สุดก่อน ไม่ซ้ำ ไม่เกินเพดาน */
export function mergeRecentTeacherIds(previous, used, cap = RECENT_TEACHER_CAP) {
  const out = [];
  for (const id of [...arr(used), ...arr(previous)]) { const k = String(id || ''); if (k && !out.includes(k)) out.push(k); }
  return out.slice(0, cap);
}

/**
 * รหัสงานที่ต้องลบเพราะเกินเพดาน (เก่าสุดก่อน · ไม่ลบงานที่กำลังทำ)
 * เพดานนับ "แยกตามที่มา": งานจาก Discord (วันละหลายร้อย) ต้องไม่ดันงานที่คนสั่งเองจากหน้าสตูดิโอออกจากประวัติ
 * งานที่คนรีวิวแล้ว (งานดี/ไม่ดี/นำไปใช้) ถูกเก็บนานกว่า: ลบเมื่อเกินสองเท่าของเพดานเท่านั้น
 */
export function overflowRunIds(runs, cap = RUN_LIMITS.maxRuns, now = Date.now()) {
  const out = [];
  for (const source of ['studio', 'discord']) {
    const group = arr(runs).filter((r) => (r?.source === 'discord' ? 'discord' : 'studio') === source)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    group.forEach((r, i) => {
      if (i < cap || effectiveStatus(r, now) === 'running') return;
      const reviewed = r.review?.status && r.review.status !== 'unreviewed';
      if (reviewed && i < cap * 2) return;
      out.push(r.id);
    });
  }
  return out;
}

/** ตัวเลขรวมของงานล่าสุด (หน้าสถานะระบบ) */
export function runStats(runs, now = Date.now()) {
  const list = arr(runs);
  const done = list.filter((r) => r.status === 'done');
  const versions = done.flatMap((r) => arr(r.versions)).filter((v) => v.content);
  const secs = done.map((r) => r.timings?.total).filter((n) => Number.isFinite(n)).map((n) => n / 1000).sort((a, b) => a - b);
  const dayAgo = now - 24 * 60 * 60 * 1000;
  return {
    total: list.length,
    done: done.length,
    failed: list.filter((r) => r.status === 'failed').length,
    stale: list.filter((r) => effectiveStatus(r, now) === 'stale').length,
    last24h: list.filter((r) => Date.parse(r.createdAt || '') >= dayAgo).length,
    versions: versions.length,
    versionsPassed: versions.filter((v) => v.ok).length,
    firstTry: versions.filter((v) => v.ok && v.attempts === 1).length,
    medianSeconds: secs.length ? Math.round(secs[secs.length >> 1]) : null,
    reviewed: { good: list.filter((r) => r.review?.status === 'good').length, bad: list.filter((r) => r.review?.status === 'bad').length, used: list.filter((r) => r.review?.status === 'used').length },
  };
}
