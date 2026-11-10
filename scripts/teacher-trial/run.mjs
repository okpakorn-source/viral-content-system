// ขั้น 3 ของชุดทดลอง: เขียนข่าวด้วย "นักเขียนแบบเลียนครู" ตัวจริง (src/lib/services/teacherWriter.js) กับเนื้อดิบจริง
// แล้ววัดผลเทียบแบบแผนครู + ผลงานของระบบปัจจุบันในข่าวเดียวกัน
// รัน: node scripts/teacher-trial/run.mjs [--limit 20] [--only 07585] [--tag v1]
// ผล: scratch/teacher-trial/results-<tag>.json + report-<tag>.md   (ใช้ค่า API จริง: 3 เวอร์ชัน/ข่าว + รอบแก้เมื่อไม่ผ่านตัวตรวจ)
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT, outPath, readJson, writeJson, loadEnvKeys, mapLimit } from './common.mjs';
import { loadTeacherLibrary, pickTeachers, countWordsThai } from '../../src/lib/services/teacherLibrary.js';
import { writeWithTeacher, checkTeacherForm, sharedRunRatio, paragraphBudget, TEACHER_FORM } from '../../src/lib/services/teacherWriter.js';
import { angleForVersion } from '../../src/lib/services/angleDirector.js';
import { pairTeachersWithAngles } from '../../src/lib/services/newsStudio/pipeline.js';

// ให้ node โหลดสมองจับคู่ตัวจริงของระบบได้ (ไฟล์นั้น import แบบ '@/lib/...')
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      let p = path.join(ROOT, 'src', specifier.slice(2));
      if (!path.extname(p)) p += '.js';
      return nextResolve(pathToFileURL(p).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { scoreLibraryPrompts } = await import('../../src/lib/services/promptMatcher.js');

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1]; };
const LIMIT = parseInt(arg('limit', '20'), 10) || 20;
const ONLY = arg('only', '');
const TAG = arg('tag', 'v1');
const MODEL = process.env.TEACHER_WRITER_MODEL || 'claude-opus-4-8'; // นักเขียนตัวเดียวกับท่อจริงตอนนี้
const EFFORT = process.env.TEACHER_WRITER_EFFORT || 'medium';

loadEnvKeys(['ANTHROPIC_API_KEY']);
const client = new Anthropic();
const usage = { calls: 0, input: 0, output: 0 };

async function callWriter({ system, user }) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: EFFORT },
    system,
    messages: [{ role: 'user', content: user }],
  });
  usage.calls++;
  usage.input += res.usage?.input_tokens || 0;
  usage.output += res.usage?.output_tokens || 0;
  if (res.stop_reason === 'refusal') throw new Error(`โมเดลปฏิเสธ (${res.stop_details?.category || 'ไม่ระบุ'})`);
  if (res.stop_reason === 'max_tokens') throw new Error('คำตอบถูกตัดที่เพดานโทเคน');
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// ผู้ตรวจข้อเท็จจริง: โมเดลเดียวกับนักเขียน แต่เป็นคำขอแยก เห็นแค่เนื้อข่าวกับโพสต์ (ไม่เห็นโพสต์ครู)
const CHECKER_MODEL = process.env.TEACHER_CHECKER_MODEL || MODEL;
const checkerUsage = { calls: 0, input: 0, output: 0 };
async function callChecker({ system, user }) {
  const res = await client.messages.create({
    model: CHECKER_MODEL,
    max_tokens: 16000,
    // งานตรวจต้องละเอียดกว่างานเขียน: เปิดให้คิดก่อนตอบ + effort สูง (รอบนำร่องที่ไม่เปิด ผู้ตรวจตอบ "ไม่พบ" เร็วเกินไป)
    thinking: { type: 'adaptive' },
    output_config: { effort: process.env.TEACHER_CHECKER_EFFORT || 'high' },
    system,
    messages: [{ role: 'user', content: user }],
  });
  checkerUsage.calls++;
  checkerUsage.input += res.usage?.input_tokens || 0;
  checkerUsage.output += res.usage?.output_tokens || 0;
  if (res.stop_reason === 'refusal') throw new Error(`ผู้ตรวจปฏิเสธ (${res.stop_details?.category || 'ไม่ระบุ'})`);
  if (res.stop_reason === 'max_tokens') throw new Error('คำตอบผู้ตรวจถูกตัดที่เพดานโทเคน');
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}
const NO_CHECK = process.argv.includes('--no-fact-check');

// ผู้อ่านจับใจความ: คำขอแยก เห็นแค่โพสต์ (ไม่เห็นเนื้อข่าว/ทิศทาง/ครู)
const readerUsage = { calls: 0, input: 0, output: 0 };
async function callReader({ system, user }) {
  const res = await client.messages.create({
    model: process.env.TEACHER_READER_MODEL || MODEL,
    max_tokens: 4000,
    output_config: { effort: process.env.TEACHER_READER_EFFORT || 'medium' },
    system,
    messages: [{ role: 'user', content: user }],
  });
  readerUsage.calls++;
  readerUsage.input += res.usage?.input_tokens || 0;
  readerUsage.output += res.usage?.output_tokens || 0;
  if (res.stop_reason === 'refusal') throw new Error('ผู้อ่านปฏิเสธ');
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}
const NO_READER = process.argv.includes('--no-reader');

const seededRand = (seed) => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
const teachers = loadTeacherLibrary();
const analyses = readJson(outPath('analyses.json'));
let cases = readJson(outPath('cases.json')).filter((c) => analyses[c.caseId]);
if (ONLY) cases = cases.filter((c) => String(c.caseId) === String(ONLY));
cases = cases.slice(0, LIMIT);

// ครูของแต่ละข่าว: ใช้ผลของบรรณารักษ์ (scripts/teacher-trial/pick.mjs → picks.json) ถ้ามี
//   ไม่มี = ทางสำรองแบบโค้ดล้วน (จำครูที่เพิ่งใช้ 30 โพสต์ล่าสุด — จำลองการเลี่ยงใบซ้ำของท่อจริง)
// ทิศทางข่าวจากผู้กำหนดทิศทาง (scripts/teacher-trial/direct.mjs → angles.json) — มี = ทุกเวอร์ชันเขียนตามทิศทาง · --no-angle = ปิดเพื่อเทียบ
const anglesFile = outPath('angles.json');
const angleBriefs = !process.argv.includes('--no-angle') && fs.existsSync(anglesFile) ? readJson(anglesFile) : {};
const picksFile = outPath('picks.json');
const picks = fs.existsSync(picksFile) ? readJson(picksFile) : {};
const teacherById = new Map(teachers.map((t) => [t.id, t]));
const recent = [];
for (const c of cases) {
  const fromLibrarian = (picks[c.caseId]?.chosen || []).map((id) => teacherById.get(id)).filter(Boolean);
  if (fromLibrarian.length === 3) {
    const reasons = new Map((picks[c.caseId].ranked || []).map((p) => [p.id, p.reason]));
    c._teachers = fromLibrarian.map((t) => ({ ...t, _matchScore: null, _pickReason: reasons.get(t.id) || '' }));
  } else {
    const scored = scoreLibraryPrompts(analyses[c.caseId], teachers, { mismatchPenalty: true });
    c._teachers = pickTeachers({ teachers, scored, count: 3, rand: seededRand(Number(c.caseId) || 1), avoidIds: recent });
  }
  for (const t of c._teachers) { recent.push(t.id); if (recent.length > 30) recent.shift(); }
}

console.log(`เขียน ${cases.length} ข่าว × 3 เวอร์ชัน ด้วย ${MODEL} (effort ${EFFORT})`);
const started = Date.now();
const results = await mapLimit(cases, 3, async (c) => {
  const t0 = Date.now();
  const versionAngles = c._teachers.map((_, vi) => angleForVersion(angleBriefs[c.caseId], vi));
  c._teachers = pairTeachersWithAngles(c._teachers, versionAngles); // วิธีเปิดของครูต้องตรงกับสิ่งที่ทิศทางชู
  const versions = await Promise.all(c._teachers.map(async (teacher, vi) => {
    const angle = versionAngles[vi];
    try {
      const r = await writeWithTeacher({ teacher, rawText: c.rawText, angle, callModel: callWriter, callChecker: NO_CHECK ? null : callChecker, callReader: NO_READER ? null : callReader, maxAttempts: 3 });
      return { teacherId: teacher.id, angle, ...r };
    } catch (e) {
      const kind = e instanceof Anthropic.RateLimitError ? 'RATE_LIMIT' : e instanceof Anthropic.APIError ? `API_${e.status}` : 'ERROR';
      return { teacherId: teacher.id, angle, ok: false, error: `${kind}: ${String(e?.message || e).slice(0, 160)}`, content: '', attempts: 0, check: null };
    }
  }));
  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(`#${c.caseId} ${versions.map((v) => (v.error ? '✖' : v.ok ? (v.attempts > 1 ? '✔(แก้)' : '✔') : '△')).join(' ')}  ${sec}s`);
  return {
    caseId: c.caseId, newsTitle: c.newsTitle, analysis: analyses[c.caseId], rawText: c.rawText, seconds: sec,
    oldTotalTimeSec: c.oldTotalTimeSec, oldVersions: c.oldVersions,
    versions: versions.map((v, i) => ({ ...v, teacher: (({ post, ...rest }) => rest)(c._teachers[i]), teacherPost: c._teachers[i].post })),
  };
});

// ───────── สรุปตัวเลข ─────────
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '-');
function profile(texts) {
  const t = texts.filter((x) => x && x.trim());
  const n = t.length;
  const words = t.map(countWordsThai);
  const first = t.map((x) => x.trim().split(/\n/)[0] || '');
  const has = (re) => pct(t.filter((x) => re.test(x)).length, n);
  return {
    n,
    'ความยาวกลาง (คำ)': med(words),
    'อยู่ในช่วง 151–249 คำ': pct(words.filter((w) => w > 150 && w < 250).length, n),
    '3 ย่อหน้าพอดี': pct(t.filter((x) => x.split(/\n\s*\n/).filter((p) => p.trim()).length === 3).length, n),
    'มีตัวเลขในประโยคแรก': pct(first.filter((x) => /[0-9๐-๙]/.test(x)).length, n),
    'เปิดด้วยคำพูด': pct(first.filter((x) => /^\s*["“”]/.test(x)).length, n),
    'ยกคำพูดคนในข่าว': has(/["“”]/),
    'ใช้โครง แม้…แต่': has(/แม้(จะ)?[^\n]{0,60}แต่/),
    'มีขีดยาว —': has(/[—–]/),
  };
}
const all = results.flatMap((r) => r.versions);
const written = all.filter((v) => v.content);
const summary = {
  tag: TAG, model: MODEL, effort: EFFORT, at: new Date().toISOString(), cases: results.length,
  versionsRequested: all.length,
  versionsWritten: written.length,
  casesWithAll3: results.filter((r) => r.versions.every((v) => v.content)).length,
  passFirstTry: written.filter((v) => v.ok && v.attempts === 1).length,
  passAfterFix: written.filter((v) => v.ok && v.attempts > 1).length,
  stillFailing: written.filter((v) => !v.ok).length,
  errors: all.filter((v) => v.error).length,
  attemptsHistogram: written.reduce((m, v) => ({ ...m, [v.attempts]: (m[v.attempts] || 0) + 1 }), {}),
  formPass: written.filter((v) => v.check.ok).length,
  withAngle: written.filter((v) => v.angle).length,
  angleDropped: written.filter((v) => v.check.fails.some((f) => f.code === 'ANGLE_DROPPED')).length,
  factChecked: written.filter((v) => v.facts?.checked).length,
  factNoMajor: written.filter((v) => v.facts?.checked && !v.facts.issues.some((i) => i.severity === 'major')).length,
  factClean: written.filter((v) => v.facts?.checked && v.facts.issues.length === 0).length,
  factIssuesLeft: written.flatMap((v) => (v.facts?.issues || []).map((i) => `${i.type}/${i.severity}`)).reduce((m, c) => ({ ...m, [c]: (m[c] || 0) + 1 }), {}),
  checkerUsage,
  readerUsage,
  // เหตุที่ต้องเขียนซ้ำ (นับจากรอบที่ไม่ใช่รอบสุดท้ายของแต่ละเวอร์ชัน)
  rewriteReasons: written.flatMap((v) => (v.trail || []).slice(0, -1).flatMap((t) => [...t.fails, ...(t.factMajor > 0 ? ['FACT_MAJOR'] : []), ...(t.readerClear === false ? ['READER'] : [])])).reduce((m, c) => ({ ...m, [c]: (m[c] || 0) + 1 }), {}),
  readerChecked: written.filter((v) => v.reader?.read).length,
  readerClear: written.filter((v) => v.reader?.read && v.reader.clear).length,
  readerOpening: written.filter((v) => v.reader?.read).map((v) => v.reader.opening).reduce((m, c) => ({ ...m, [c]: (m[c] || 0) + 1 }), {}),
  readerHardParts: written.flatMap((v) => (v.reader?.hardParts || []).map((h) => h.kind)).reduce((m, c) => ({ ...m, [c]: (m[c] || 0) + 1 }), {}),
  paragraphCharsMedian: [0, 1, 2].map((i) => med(written.filter((v) => v.check.metrics.paragraphChars?.length === 3).map((v) => v.check.metrics.paragraphChars[i]))),
  openingVsTeacherPctMedian: med(written.map((v) => {
    const pb = paragraphBudget(teacherById.get(v.teacherId)?.post);
    return pb && v.check.metrics.paragraphChars?.length === 3 ? Math.round((v.check.metrics.paragraphChars[0] / pb.teacherOpening) * 100) : 0;
  }).filter(Boolean)),
  closingVsTeacherPctMedian: med(written.map((v) => {
    const pb = paragraphBudget(teacherById.get(v.teacherId)?.post);
    return pb && v.check.metrics.paragraphChars?.length === 3 ? Math.round((v.check.metrics.paragraphChars[2] / pb.teacherClosing) * 100) : 0;
  }).filter(Boolean)),
  failCodes: written.flatMap((v) => v.check.fails.map((f) => f.code)).reduce((m, c) => ({ ...m, [c]: (m[c] || 0) + 1 }), {}),
  warnCodes: written.flatMap((v) => v.check.warns.map((f) => f.code)).reduce((m, c) => ({ ...m, [c]: (m[c] || 0) + 1 }), {}),
  rawCopyPctMedianNew: med(written.map((v) => v.check.metrics.rawCopyPct)),
  rawCopyPctMedianOld: med(results.flatMap((r) => r.oldVersions.map((o) => Math.round(sharedRunRatio(o.content, r.rawText, 10) * 100)))),
  secondsPerNewsMedian: med(results.map((r) => r.seconds)),
  oldSecondsPerNewsMedian: med(results.map((r) => Number(r.oldTotalTimeSec) || 0).filter(Boolean)),
  usage,
  wallSeconds: Math.round((Date.now() - started) / 1000),
  profiles: {
    'ครู 254 โพสต์': profile(teachers.map((t) => t.post)),
    'ระบบใหม่': profile(written.map((v) => v.content)),
    'ระบบปัจจุบัน (ข่าวเดียวกัน)': profile(results.flatMap((r) => r.oldVersions.map((o) => o.content))),
  },
  oldFormPass: (() => { const o = results.flatMap((r) => r.oldVersions.map((x) => checkTeacherForm(x.content, { rawText: r.rawText }).ok)); return `${o.filter(Boolean).length}/${o.length}`; })(),
};
writeJson(outPath(`results-${TAG}.json`), { summary, results });

// ───────── รายงานอ่านง่าย ─────────
const L = [];
L.push(`# ผลทดลองนักเขียนแบบเลียนครู — ชุด ${TAG}`, '');
L.push(`โมเดล ${MODEL} (effort ${EFFORT}) · ${results.length} ข่าวจริง · ขอ ${summary.versionsRequested} เวอร์ชัน ได้ ${summary.versionsWritten}`, '');
L.push(`- ผ่านแบบแผนครู: ${summary.formPass}/${summary.versionsWritten} · ผู้ตรวจข้อเท็จจริงไม่พบจุดร้ายแรง: ${summary.factNoMajor}/${summary.factChecked} · ไม่พบจุดใดเลย: ${summary.factClean}`);
L.push(`- ผ่านทั้งหมดตั้งแต่รอบแรก: ${summary.passFirstTry} · ผ่านหลังแก้ 1 รอบ: ${summary.passAfterFix} · ยังไม่ผ่าน: ${summary.stillFailing} · เรียกโมเดลล้ม: ${summary.errors}`);
L.push(`- ผู้อ่านจับใจความ (เห็นแค่โพสต์): อ่านแล้ว ${summary.readerChecked} · เข้าใจทันที ${summary.readerClear} · ย่อหน้าแรก ${JSON.stringify(summary.readerOpening)}`);
L.push(`- ความยาวย่อหน้า 1/2/3 (ตัวอักษร ค่ากลาง): ${summary.paragraphCharsMedian.join(' / ')} · ย่อหน้าแรกเทียบครูที่เลียน ${summary.openingVsTeacherPctMedian}% · ย่อหน้าท้าย ${summary.closingVsTeacherPctMedian}%`);
L.push(`- ข่าวที่ได้ครบ 3 เวอร์ชัน: ${summary.casesWithAll3}/${results.length}`);
L.push(`- ผลงานระบบปัจจุบันในข่าวเดียวกัน ผ่านตัวตรวจเดียวกัน: ${summary.oldFormPass}`);
L.push(`- ถ้อยคำตรงกับเนื้อดิบ (ค่ากลาง): ระบบใหม่ ${summary.rawCopyPctMedianNew}% · ระบบปัจจุบัน ${summary.rawCopyPctMedianOld}%`);
L.push(`- เวลาเขียนต่อข่าว (ค่ากลาง · เฉพาะขั้นเขียน): ${summary.secondsPerNewsMedian} วินาที · ระบบปัจจุบันทั้งท่อ ${summary.oldSecondsPerNewsMedian} วินาที`, '');
const names = Object.keys(summary.profiles);
L.push(`| ลักษณะ | ${names.join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`);
for (const k of Object.keys(summary.profiles[names[0]])) L.push(`| ${k} | ${names.map((n) => summary.profiles[n][k]).join(' | ')} |`);
L.push('');
for (const r of results) {
  L.push('---', '', `## เคส #${r.caseId} — ${r.newsTitle || ''}`, '');
  L.push(`หมวดที่วิเคราะห์: ${r.analysis.primaryCategory} · อารมณ์: ${(r.analysis.emotionalTags || []).join(', ')}`, '');
  L.push(`### เนื้อดิบจากพนักงาน (${countWordsThai(r.rawText)} คำ)`, '', r.rawText, '');
  r.versions.forEach((v, i) => {
    L.push(`### เวอร์ชัน ${i + 1} — เลียนครู: ${v.teacher.name}`, '');
    L.push(`ครู: ${v.teacher.category} · ${(v.teacher.views / 1e6).toFixed(1)} ล้านวิว · วิธีเปิด ${v.teacher.openingType} · ${v.teacher.url}`);
    if (v.angle) L.push(`ทิศทางข่าว: ${v.angle.focus} · พาดปก: ${v.angle.coverLines.join(' / ')} · ต้นแบบ: ${v.angle.exemplarIds.join(', ')}`);
    if (v.teacher._pickReason) L.push(`เหตุผลที่เลือกครูใบนี้: ${v.teacher._pickReason}`);
    L.push('');
    if (v.error) { L.push(`**เขียนไม่สำเร็จ:** ${v.error}`, ''); return; }
    const m = v.check.metrics;
    L.push(`ผล: ${v.ok ? 'ผ่าน' : '**ยังไม่ผ่าน**'} (เขียน ${v.attempts} รอบ) · ${m.words} คำ · ${m.paragraphs} ย่อหน้า · ตรงเนื้อดิบ ${m.rawCopyPct}%`);
    for (const f of v.check.fails) L.push(`- ตก: ${f.message}`);
    for (const w of v.check.warns) L.push(`- เตือน: ${w.message}`);
    if (v.facts && !v.facts.checked) L.push('- **ยังไม่ได้ตรวจข้อเท็จจริง** (ผู้ตรวจล้ม)');
    if (v.reader?.read) L.push(`- ผู้อ่าน: ย่อหน้าแรก "${v.reader.opening}" — ${v.reader.gist}`);
    for (const h of v.reader?.hardParts || []) L.push(`- ผู้อ่านตามไม่ได้ (${h.kind}): "${h.quote}" — ${h.why}`);
    for (const i of v.facts?.issues || []) L.push(`- ผู้ตรวจข้อเท็จจริง (${i.severity === 'major' ? 'ร้ายแรง' : 'เล็กน้อย'} · ${i.type}): "${i.quote}" — ${i.problem}`);
    L.push('', v.content, '', '<details><summary>โพสต์ครูที่เลียน</summary>', '', v.teacherPost, '', '</details>', '');
  });
  L.push(`### ระบบปัจจุบันเขียนข่าวนี้ไว้ ${r.oldVersions.length} เวอร์ชัน (${r.oldVersions.map((o) => countWordsThai(o.content) + ' คำ').join(', ')})`, '');
  if (r.oldVersions[0]) L.push('<details><summary>เวอร์ชันแรกของระบบปัจจุบัน</summary>', '', r.oldVersions[0].content, '', '</details>', '');
}
fs.writeFileSync(outPath(`report-${TAG}.md`), L.join('\n'), 'utf8');

console.log('\n' + JSON.stringify({ ...summary, profiles: undefined }, null, 1));
console.table(summary.profiles);
console.log(`\nรายงาน: scratch/teacher-trial/report-${TAG}.md`);
