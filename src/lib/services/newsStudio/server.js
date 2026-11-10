/**
 * =====================================================
 * News Studio — ตัวต่อสายจริงฝั่งเซิร์ฟเวอร์ (10 พ.ย. 69)
 * =====================================================
 * ต่อ "ท่อเขียนข่าวตัวใหม่" (pipeline.js — ตัวเดินงานล้วน) เข้ากับของจริง:
 *   โมเดล (callers.js) · คลังครู/คลังต้นแบบประเด็น (ไฟล์ data/) · สมองให้คะแนนครูของระบบ (promptMatcher)
 *   · ตัวค้นข้อมูลเสริมเดิมของระบบ (achievementResearch) · คลังประวัติงาน (persistStore) · ตัวบันทึกค่าใช้จ่าย (usageLogger)
 *
 * ใช้จาก route ใต้ /api/news-studio/* และจากท่อ Discord (discordFlow.js → /api/auto/process)
 */
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createStore } from '@/lib/persistStore';
import { isSupabaseReady } from '@/lib/supabase';
import { logApiUsage } from '@/lib/ai/usageLogger';
import { scoreLibraryPrompts } from '@/lib/services/promptMatcher';
import { smartResearch } from '@/lib/services/achievementResearch';
import { loadTeacherLibrary } from '@/lib/services/teacherLibrary';
import { loadAngleExemplars } from '@/lib/services/angleDirector';
import { TEACHER_FORM, READER_MAX_HARD_PARTS } from '@/lib/services/teacherWriter';
import { runNewsStudio, NEWS_STUDIO, buildAnalyzerPrompt, buildLibrarianPrompt } from './pipeline';
import { studioModels, makeAnthropicCaller, makeOpenAIJsonCaller, STUDIO_BUDGET } from './callers';
import { isStudioDiscordEnabled, isStudioDiscordResearchOn } from './switches';
import {
  RUN_LIMITS, newRunId, isRunId, startedRun, finishedRun, failedRun, listRow,
  recentTeacherIds, overflowRunIds, runStats, effectiveStatus, mergeReview, quotaState, RECENT_ROW_ID, mergeRecentTeacherIds,
} from './runStore';

export const RUN_STORE_NAME = 'news-studio-runs';
const RESEARCH_TIMEOUT_MS = 40000;
const PRUNE_SLACK = 20;

function fail(errorType, message, status = 500) {
  const err = new Error(message);
  err.errorType = errorType;
  err.status = status;
  return err;
}

const envKey = (name) => String(process.env[name] ?? '').trim();

// ───────── client ของโมเดล (สร้างเมื่อใช้ครั้งแรก · ไม่มีคีย์ = null แล้วตัวเรียกจะบอกเหตุเอง) ─────────
let _anthropic;
let _openai;
function anthropicClient() {
  if (_anthropic === undefined) _anthropic = envKey('ANTHROPIC_API_KEY') ? new Anthropic({ apiKey: envKey('ANTHROPIC_API_KEY') }) : null;
  return _anthropic;
}
function openaiClient() {
  if (_openai === undefined) _openai = envKey('OPENAI_API_KEY') ? new OpenAI({ apiKey: envKey('OPENAI_API_KEY') }) : null;
  return _openai;
}

const researchAvailable = () => !!(envKey('SERPER_API_KEY') || envKey('TAVILY_API_KEY'));

/** คลังประวัติงาน — เลือกโหมด (Supabase / ไฟล์) ตอนเรียก ไม่ใช่ตอนโหลดไฟล์ */
const runStore = () => createStore(RUN_STORE_NAME);

async function allRuns() {
  const rows = await runStore().getAll();
  return (Array.isArray(rows) ? rows : []).filter((r) => r && isRunId(r.id));
}

// ───────── คุมจำนวนงานพร้อมกัน (1 งาน = เรียกโมเดลราว 10–20 ครั้ง) ─────────
let activeJobs = 0;
const maxConcurrent = () => Math.max(1, Math.min(4, parseInt(envKey('NEWS_STUDIO_MAX_CONCURRENT') || '2', 10) || 2));

const envInt = (name, fallback, min, max) => { const n = parseInt(envKey(name), 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };
/** เพดานจำนวนงาน (นับจากคลังประวัติ = ใช้ร่วมกันทุกเครื่อง) — กันสคริปต์/บัญชีที่หลุดยิงสั่งเขียนไม่หยุด */
export const studioQuota = () => ({
  perHour: envInt('NEWS_STUDIO_MAX_RUNS_PER_HOUR', 40, 1, 1000),
  perUserHour: envInt('NEWS_STUDIO_MAX_RUNS_PER_USER_HOUR', 20, 1, 1000),
  perDay: envInt('NEWS_STUDIO_MAX_RUNS_PER_DAY', 300, 1, 10000),
});

/**
 * ด่านก่อนเริ่มงาน: งานพร้อมกันทั้งระบบ + โควตารายชั่วโมง/รายวัน — route ต้อง await ก่อนเรียก runStudioJob
 * คืนภาพคลังประวัติที่อ่านมา (ส่งต่อให้ runStudioJob ใช้ซ้ำ ไม่อ่านคลังทั้งก้อนซ้ำอีก)
 * อ่านคลังไม่ได้ = ปล่อยผ่าน (เหลือด่านตัวนับในเครื่อง) — คลังล่มไม่ควรทำให้ทั้งทีมเขียนข่าวไม่ได้
 */
export async function assertStudioQuota(user) {
  let runs;
  try { runs = await allRuns(); } catch { return { runs: null }; }
  const q = studioQuota();
  const st = quotaState(runs, { username: user?.username || '' });
  if (st.running >= maxConcurrent()) throw fail('NEWS_STUDIO_BUSY', `มีงานเขียนกำลังทำอยู่ ${st.running} งาน (เต็มจำนวนที่รับพร้อมกัน) — รอสักครู่แล้วลองใหม่`, 429);
  if (st.hourUser >= q.perUserHour) throw fail('NEWS_STUDIO_QUOTA', `บัญชีนี้สั่งเขียนครบ ${q.perUserHour} งานในชั่วโมงนี้แล้ว — รอให้พ้นชั่วโมงแล้วลองใหม่`, 429);
  if (st.hourAll >= q.perHour) throw fail('NEWS_STUDIO_QUOTA', `ทั้งระบบสั่งเขียนครบ ${q.perHour} งานในชั่วโมงนี้แล้ว — รอให้พ้นชั่วโมงแล้วลองใหม่`, 429);
  if (st.dayAll >= q.perDay) throw fail('NEWS_STUDIO_QUOTA', `ทั้งระบบสั่งเขียนครบ ${q.perDay} งานใน 24 ชั่วโมงแล้ว`, 429);
  return { runs };
}

/** ของจริงทั้งหมดที่ท่อต้องใช้ — แยกเป็นฟังก์ชันให้เห็นว่า "ต่ออะไรกับอะไร" ที่เดียว */
function buildDeps({ userId, snapshot }) {
  const models = studioModels();
  const logUsage = (u) => logApiUsage({ ...u, userId: userId || null });
  const anthropic = anthropicClient();
  const openai = openaiClient();
  const analyzeCall = makeOpenAIJsonCaller({ client: openai, spec: models.analyzer, role: 'ตัววิเคราะห์หมวดข่าว', logUsage });
  const librarianCall = makeOpenAIJsonCaller({ client: openai, spec: models.librarian, role: 'บรรณารักษ์เลือกครู', logUsage });
  const deps = {
    loadTeachers: () => loadTeacherLibrary(),
    loadExemplars: () => loadAngleExemplars(),
    scoreTeachers: (analysis, teachers) => scoreLibraryPrompts(analysis, teachers, { mismatchPenalty: false }),
    callDirector: makeAnthropicCaller({ client: anthropic, spec: models.director, role: 'ผู้กำหนดทิศทางข่าว', logUsage }),
    callWriter: makeAnthropicCaller({ client: anthropic, spec: models.writer, role: 'นักเขียน', logUsage }),
    callChecker: makeAnthropicCaller({ client: anthropic, spec: models.checker, role: 'ผู้ตรวจข้อเท็จจริง', logUsage }),
    callReader: makeAnthropicCaller({ client: anthropic, spec: models.reader, role: 'ผู้อ่านจับใจความ', logUsage }),
    analyze: (raw) => analyzeCall(buildAnalyzerPrompt(raw)),
    librarian: async ({ rawText, shortlist, angles }) => {
      const obj = await librarianCall(buildLibrarianPrompt({ rawText, shortlist, angles }));
      return Array.isArray(obj?.picks) ? obj.picks : [];
    },
    // ครูที่เพิ่งใช้: อ่านจากแถวเล็กแถวเดียว (ท่อ Discord วิ่งวันละหลายร้อยงาน — ห้ามอ่านคลังประวัติทั้งก้อนทุกงาน)
    //   ยังไม่มีแถวนั้น (งานแรกหลังขึ้นระบบ) → ใช้ภาพคลังที่ด่านโควตาอ่านไว้ ถ้ามี
    getRecentTeacherIds: async () => {
      const rec = await runStore().findById(RECENT_ROW_ID);
      if (rec && Array.isArray(rec.ids)) return rec.ids;
      return snapshot ? recentTeacherIds(snapshot) : [];
    },
    rememberTeacherIds: async (ids) => {
      const store = runStore();
      const rec = await store.findById(RECENT_ROW_ID);
      const next = mergeRecentTeacherIds(rec?.ids, ids);
      const merge = () => store.update(RECENT_ROW_ID, (cur) => ({ ...cur, ids: mergeRecentTeacherIds(cur?.ids, ids) }));
      if (rec) await merge();
      // สองงานแรกจบพร้อมกัน: งานที่มาทีหลัง add ชนรหัสซ้ำ → ถอยไปรวมเข้ากับแถวที่อีกงานเพิ่งสร้าง (ไม่ทิ้งรหัสครูของตัวเอง)
      else await store.add({ id: RECENT_ROW_ID, createdAt: new Date().toISOString(), ids: next }).catch(merge);
    },
  };
  if (researchAvailable()) {
    // ตัวค้นข้อมูลเสริมเดิมของระบบ (ค้น + คัดเฉพาะข้อเท็จจริงที่ยืนยันตัวบุคคลได้) — คืน null เมื่อไม่พบของที่ใช้ได้
    deps.research = async (raw) => {
      const newsData = { newsTitle: String(raw).trim().split('\n')[0].slice(0, 120), newsBody: raw };
      const pool = await Promise.race([
        smartResearch(newsData, null),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`ค้นข้อมูลเสริมเกิน ${RESEARCH_TIMEOUT_MS / 1000} วินาที`)), RESEARCH_TIMEOUT_MS)),
      ]);
      return (pool?.facts || []).map((f) => `${String(f.text || '').trim()}${f.source ? ` (ที่มา: ${f.source})` : ''}`).filter((s) => s.length > 3);
    };
  }
  return { deps, models };
}

const publicModels = (models) => Object.fromEntries(Object.entries(models).map(([role, m]) => [role, { model: m.model, effort: m.effort || '', thinking: !!m.thinking }]));

/**
 * เขียนข่าว 1 งาน + เก็บลงคลังประวัติ
 * ไม่โยน error ของตัวงานออกมา — ทุกผล (สำเร็จ/ล้ม) ถูกส่งผ่าน onEvent และถูกเก็บลงคลัง
 * โยนเฉพาะกรณีที่ "ยังไม่ได้เริ่มงาน" (งานพร้อมกันเต็ม)
 * @param {(e:object) => void} onEvent  start | progress | warning | result | error
 * @param {'studio'|'discord'} [source]  discord = งานจากคิวของบอท: คิวคุมจำนวนงานพร้อมกันเองอยู่แล้ว จึงไม่ผ่านด่านงานเต็มของหน้าเว็บ (ไม่งั้นข่าวของพนักงานถูกปัดตกเมื่อมีคนใช้หน้าเว็บอยู่)
 * @returns {Promise<object>} แถวงานสุดท้าย (done หรือ failed)
 */
export async function runStudioJob({ rawText, useResearch = false, user, onEvent = () => {}, snapshot = null, source = 'studio', budget = null }) {
  const fromStudio = source !== 'discord';
  // งบเวลา: หน้าเว็บผูกกับ maxDuration 300 ของ route · งานจากคิวของบอทมีเวลามากกว่า (ผู้เรียกส่ง budget มา)
  const retryDeadlineMs = Number.isFinite(budget?.retryDeadlineMs) ? budget.retryDeadlineMs : STUDIO_BUDGET.retryDeadlineMs;
  const hardMs = Number.isFinite(budget?.hardMs) ? budget.hardMs : STUDIO_BUDGET.hardMs;
  if (fromStudio && activeJobs >= maxConcurrent()) throw fail('NEWS_STUDIO_BUSY', `มีงานเขียนกำลังทำอยู่ ${activeJobs} งาน (เต็มจำนวนที่รับพร้อมกัน) — รอสักครู่แล้วลองใหม่`, 429);
  if (fromStudio) activeJobs++;
  const emit = (e) => { try { onEvent(e); } catch { /* ผู้ฟังหลุด (ปิดหน้าจอ) ไม่ทำให้งานหยุด */ } };
  const store = runStore();
  const id = newRunId();
  let row = startedRun({ id, rawText, useResearch, user, createdAt: new Date().toISOString(), source });
  let saved = true;
  const save = async (next, first = false) => {
    try {
      if (first) await store.add(next); else await store.update(id, () => next);
      return true;
    } catch (e) {
      if (saved) emit({ type: 'warning', code: 'RUN_NOT_SAVED', message: `บันทึกงานลงคลังประวัติไม่สำเร็จ — ผลยังแสดงบนหน้านี้ แต่จะไม่อยู่ในประวัติ (${String(e?.message || e).slice(0, 100)})` });
      saved = false;
      return false;
    }
  };
  try {
    await save(row, true);
    emit({ type: 'start', runId: id, saved, at: row.createdAt });
    const usageUser = fromStudio ? (user?.username ? `studio-${user.username}` : 'studio') : (user?.username || 'discord');
    const { deps, models } = buildDeps({ userId: usageUser, snapshot });
    try {
      // เส้นตายแข็งของทั้งงาน: เลยแล้วปิดเป็น "ไม่สำเร็จ" และบันทึกเหตุ ก่อนโฮสต์ตัดฟังก์ชัน (ไม่งั้นงานค้าง "กำลังเขียน" และผลหายเงียบ)
      let hardTimer;
      const result = await Promise.race([
        runNewsStudio({ rawText, useResearch, deps, retryDeadlineMs, onProgress: (e) => emit({ type: 'progress', ...e }) }),
        new Promise((_, reject) => { hardTimer = setTimeout(() => reject(fail('NEWS_STUDIO_TIMEOUT', `งานใช้เวลาเกิน ${Math.round(hardMs / 1000)} วินาที (โมเดลตอบช้าผิดปกติ) จึงหยุดงานนี้ — ส่งเนื้อดิบเข้าใหม่ได้`, 504)), hardMs); }),
      ]).finally(() => clearTimeout(hardTimer));
      row = finishedRun(row, { result, models: publicModels(models), finishedAt: new Date().toISOString() });
      if (!saved) row.warnings = [...(row.warnings || []), { code: 'RUN_NOT_SAVED', message: 'งานนี้ไม่ได้ถูกบันทึกลงคลังประวัติ' }];
      else if (!(await save(row))) row.warnings = [...(row.warnings || []), { code: 'RUN_NOT_SAVED', message: 'งานนี้ไม่ได้ถูกบันทึกลงคลังประวัติ' }];
      emit({ type: 'result', run: row });
    } catch (e) {
      row = failedRun(row, { error: e?.message || String(e), errorType: e?.errorType, finishedAt: new Date().toISOString() });
      await save(row);
      emit({ type: 'error', runId: id, error: row.error, errorType: row.errorType });
    }
    // เกินเพดานคลัง → ลบงานเก่าสุด (ล้มได้ ไม่กระทบงานนี้)
    //   ใช้ภาพคลังที่ด่านโควตาอ่านไว้แล้ว — อ่านคลังทั้งก้อนซ้ำเฉพาะเมื่อไม่มีภาพนั้น
    if (saved) {
      try {
        //   ไม่มีภาพคลัง (ท่อ Discord): นับจำนวนแถวก่อน (ถูก) แล้วอ่านทั้งก้อนเฉพาะเมื่อเกินเพดานไปแล้ว PRUNE_SLACK งาน (≈ อ่านทั้งก้อน 1 ครั้งต่อ PRUNE_SLACK งาน)
        let known = snapshot ? [...snapshot.filter((r) => r.id !== id), row] : null;
        //   เพดานนับแยกตามที่มา (หน้าเว็บ / Discord) — จำนวนแถวรวมที่ต้องเริ่มลบจึงเป็นสองเท่าของเพดาน
        if (!known && (await store.count()) > RUN_LIMITS.maxRuns * 2 + PRUNE_SLACK) known = await allRuns();
        if (known) for (const old of overflowRunIds(known)) await store.remove(old).catch(() => {});
      } catch { /* รอบหน้าลบใหม่ */ }
    }
    return row;
  } finally {
    if (fromStudio) activeJobs--;
  }
}

/** ผูกเลขเคสของคลัง "ผลงานที่เขียนแล้ว" เข้ากับงาน (ท่อ Discord) — ล้มได้ ไม่กระทบผลที่ส่งให้พนักงาน */
export async function attachCaseId(runId, caseId) {
  if (!isRunId(runId) || !caseId) return false;
  try { await runStore().update(runId, (cur) => ({ ...cur, caseId: String(caseId).slice(0, 20) })); return true; } catch { return false; }
}

/** รายการงาน (ย่อ) ใหม่สุดก่อน */
export async function listRuns({ limit = 60 } = {}) {
  const rows = (await allRuns()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const now = Date.now();
  return { total: rows.length, runs: rows.slice(0, Math.max(1, Math.min(RUN_LIMITS.maxRuns, limit))).map((r) => listRow(r, now)), stats: runStats(rows, now) };
}

/** งานเดียวฉบับเต็ม */
export async function getRun(id) {
  if (!isRunId(id)) throw fail('BAD_RUN_ID', 'รหัสงานไม่ถูกต้อง', 400);
  let row = await runStore().findById(id);
  // รายการงานอ่านผ่าน getAll ซึ่งถอยไปไฟล์สำรองได้ — งานที่ขึ้นในรายการต้องเปิดได้เสมอ จึงหาในแหล่งเดียวกันอีกชั้น
  if (!row) row = (await allRuns().catch(() => [])).find((r) => r.id === id) || null;
  if (!row) throw fail('RUN_NOT_FOUND', 'ไม่พบงานนี้ในคลังประวัติ (อาจถูกลบเพราะเกินเพดานคลัง)', 404);
  return { ...row, status: effectiveStatus(row) };
}

/** บันทึกผลรีวิวของคน (ดี / ไม่ดี / นำไปใช้แล้ว + เวอร์ชันที่เลือก + หมายเหตุ) */
export async function reviewRun(id, body, user) {
  const row = await getRun(id);
  if (row.status !== 'done') throw fail('RUN_NOT_FINISHED', 'รีวิวได้เฉพาะงานที่เขียนเสร็จแล้ว', 409);
  const opts = { versionCount: (row.versions || []).length || NEWS_STUDIO.versions, user };
  const v = mergeReview(row.review, body, opts);
  if (!v.ok) throw fail(v.errorType, v.error, 400);
  if (v.review.pickedVersion && !(row.versions || []).some((x) => x.index === v.review.pickedVersion && x.content)) throw fail('BAD_PICKED_VERSION', 'เวอร์ชันที่เลือกไม่มีเนื้อข่าว', 400);
  try {
    // รวมกับผลรีวิวล่าสุด "ตอนเขียน" อีกครั้ง — ช่องที่คำขอนี้ไม่ได้แตะต้องไม่ถูกทับด้วยค่าที่อ่านไว้ก่อนหน้า
    await runStore().update(id, (cur) => { const m = mergeReview(cur?.review, body, opts); return { ...cur, review: m.ok ? m.review : v.review }; });
  } catch (e) {
    throw fail('REVIEW_NOT_SAVED', `บันทึกผลรีวิวไม่สำเร็จ: ${String(e?.message || e).slice(0, 120)}`);
  }
  return v.review;
}

// ───────── คลังต้นแบบประเด็น + คลังครู (อ่านอย่างเดียว) ─────────

const exemplarImageUrl = (id) => `/api/news-studio/exemplar-image?id=${encodeURIComponent(id)}`;

export function libraryExemplars() {
  const exemplars = loadAngleExemplars();
  const byTechnique = {};
  for (const x of exemplars) byTechnique[x.technique || 'other'] = (byTechnique[x.technique || 'other'] || 0) + 1;
  return {
    total: exemplars.length,
    techniques: byTechnique,
    items: exemplars.map((x) => ({
      id: x.id, imageUrl: exemplarImageUrl(x.id), lines: x.lines || [], lineRoles: x.lineRoles || [], subject: x.subject || '', angle: x.angle || '',
      technique: x.technique || 'other', techniqueNote: x.techniqueNote || '', emotion: x.emotion || '', hasQuote: !!x.hasQuote, hasNumber: !!x.hasNumber,
    })),
  };
}

/** พาธไฟล์ภาพปกต้นแบบ — รับเฉพาะรหัสที่มีอยู่ในคลัง (กันอ่านไฟล์อื่นผ่านพารามิเตอร์) */
export function exemplarImageFile(id) {
  const key = String(id || '');
  if (!/^a\d{2,3}$/.test(key)) throw fail('BAD_EXEMPLAR_ID', 'รหัสต้นแบบไม่ถูกต้อง', 400);
  const found = loadAngleExemplars().find((x) => x.id === key);
  if (!found) throw fail('EXEMPLAR_NOT_FOUND', 'ไม่พบต้นแบบนี้', 404);
  const file = path.join(process.cwd(), ...['data', 'angle-exemplars', 'images'], `${key}.jpg`);
  if (!fs.existsSync(file)) throw fail('EXEMPLAR_IMAGE_MISSING', `ไม่พบไฟล์ภาพของต้นแบบ ${key}`, 404);
  return file;
}

const teacherCard = (t, withPost) => ({
  id: t.id, name: t.name, category: t.category, views: t.views, openingType: t.openingType, words: t.words, url: t.url || '',
  emotionalTags: t.emotionalTags || [], whyItWorks: t.whyItWorks || '', ...(withPost ? { post: t.post } : { opening: String(t.post || '').split('\n')[0].slice(0, 220) }),
});

export function libraryTeachers({ q = '', category = '', opening = '', offset = 0, limit = 30 } = {}) {
  const all = loadTeacherLibrary();
  const count = (key) => all.reduce((m, t) => ({ ...m, [t[key] || '-']: (m[t[key] || '-'] || 0) + 1 }), {});
  const needle = String(q || '').trim().toLowerCase();
  let rows = all;
  if (category) rows = rows.filter((t) => t.category === category);
  if (opening) rows = rows.filter((t) => t.openingType === opening);
  if (needle) rows = rows.filter((t) => `${t.name} ${t.post}`.toLowerCase().includes(needle));
  rows = [...rows].sort((a, b) => (b.views || 0) - (a.views || 0));
  const from = Math.max(0, parseInt(offset, 10) || 0);
  const size = Math.max(1, Math.min(60, parseInt(limit, 10) || 30));
  return { total: all.length, matched: rows.length, offset: from, items: rows.slice(from, from + size).map((t) => teacherCard(t, true)), categories: count('category'), openings: count('openingType') };
}

export function teacherById(id) {
  const t = loadTeacherLibrary().find((x) => x.id === String(id || ''));
  if (!t) throw fail('TEACHER_NOT_FOUND', 'ไม่พบโพสต์ครูนี้ในคลัง', 404);
  return teacherCard(t, true);
}

// ───────── สถานะระบบ ─────────

/** สถานะของระบบเขียนตัวใหม่ — บอกแค่ "มี/ไม่มี" คีย์ ไม่ส่งค่าคีย์ออกไป */
export async function studioStatus() {
  const models = studioModels();
  const safe = (fn) => { try { return { ok: true, ...fn() }; } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 200), errorType: e?.errorType || 'LIBRARY_FAILED' }; } };
  const teachers = safe(() => { const t = loadTeacherLibrary(); return { count: t.length }; });
  const exemplars = safe(() => { const x = loadAngleExemplars(); return { count: x.length }; });
  let runs = { ok: true };
  let running = activeJobs;
  try { const all = await allRuns(); runs = { ok: true, ...runStats(all) }; running = Math.max(activeJobs, quotaState(all).running); } catch (e) { runs = { ok: false, error: String(e?.message || e).slice(0, 200) }; }
  // authSecret=false = ระบบล็อกอินทั้งเว็บยังใช้ค่าลับสำรองที่เขียนอยู่ในโค้ด (ใครเห็นซอร์สก็ปลอมบัตรล็อกอินได้) — บอกแค่มี/ไม่มี
  const keys = { anthropic: !!envKey('ANTHROPIC_API_KEY'), openai: !!envKey('OPENAI_API_KEY'), research: researchAvailable(), authSecret: !!envKey('AUTH_SECRET') };
  return {
    ready: keys.anthropic && keys.openai && teachers.ok && exemplars.ok,
    keys,
    models: publicModels(models),
    libraries: { teachers, exemplars },
    store: { mode: isSupabaseReady() ? 'supabase' : 'file', name: RUN_STORE_NAME, maxRuns: RUN_LIMITS.maxRuns },
    runs,
    jobs: { active: running, max: maxConcurrent(), quota: studioQuota(), hardSeconds: Math.round(STUDIO_BUDGET.hardMs / 1000) },
    rules: {
      versions: NEWS_STUDIO.versions, writeAttempts: NEWS_STUDIO.writeAttempts, minRawChars: NEWS_STUDIO.minRawChars, maxRawChars: NEWS_STUDIO.maxRawChars,
      paragraphs: TEACHER_FORM.paragraphs, minWords: TEACHER_FORM.minWords, maxWords: TEACHER_FORM.maxWords, minChars: TEACHER_FORM.minChars, maxChars: TEACHER_FORM.maxChars,
      maxRawRun: TEACHER_FORM.maxRawRun, maxRawCopyPct: Math.round(TEACHER_FORM.maxRawCopy * 100), retellMinRawRatio: TEACHER_FORM.retellMinRawRatio, readerMaxHardParts: READER_MAX_HARD_PARTS,
    },
    // ท่อ Discord: โค้ดชุดนี้ส่งงานข้อความล้วนจากบอทเข้าระบบเขียนตัวใหม่ เว้นแต่ตั้ง NEWS_STUDIO_DISCORD=0 (มีผลเมื่อโค้ดชุดนี้ถูก deploy แล้วเท่านั้น)
    discord: { usesStudio: isStudioDiscordEnabled(), research: isStudioDiscordResearchOn() },
  };
}
