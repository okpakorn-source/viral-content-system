// ปรับเทียบ "ผู้อ่านจับใจความ" ก่อนใช้เป็นด่าน: ให้อ่านโพสต์ครูจริง (ควรผ่านเกือบหมด — ครูคือคำตอบที่ถูก) เทียบกับผลงานรอบก่อนของระบบ
// รัน: node scripts/teacher-trial/reader-calibrate.mjs [--teachers 40] [--tag v5]
// ผล: scratch/teacher-trial/reader-calibrate-<tag>.json
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import { outPath, readJson, writeJson, loadEnvKeys, mapLimit } from './common.mjs';
import { loadTeacherLibrary } from '../../src/lib/services/teacherLibrary.js';
import { buildReaderPrompt, readReaderReport } from '../../src/lib/services/teacherWriter.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1]; };
const N_TEACHERS = parseInt(arg('teachers', '40'), 10) || 40;
const TAG = arg('tag', 'v5');
const MODEL = process.env.TEACHER_READER_MODEL || 'claude-opus-4-8';
const EFFORT = process.env.TEACHER_READER_EFFORT || 'medium';

loadEnvKeys(['ANTHROPIC_API_KEY']);
const client = new Anthropic();

async function callReader({ system, user }) {
  const res = await client.messages.create({ model: MODEL, max_tokens: 4000, output_config: { effort: EFFORT }, system, messages: [{ role: 'user', content: user }] });
  if (res.stop_reason === 'refusal') throw new Error('ผู้อ่านปฏิเสธ');
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

const teachers = loadTeacherLibrary();
const step = Math.max(1, Math.floor(teachers.length / N_TEACHERS));
const sample = teachers.filter((_, i) => i % step === 0).slice(0, N_TEACHERS).map((t) => ({ group: 'teacher', id: t.id, content: t.post }));
const resultsFile = outPath(`results-${TAG}.json`);
const system = fs.existsSync(resultsFile)
  ? readJson(resultsFile).results.flatMap((r) => r.versions.filter((v) => v.content).map((v, i) => ({ group: 'system', id: `${r.caseId}-${i + 1}`, content: v.content })))
  : [];

const items = [...sample, ...system];
console.log(`อ่าน ${sample.length} โพสต์ครู + ${system.length} โพสต์ของระบบ (${TAG}) ด้วย ${MODEL} effort ${EFFORT}`);
const out = await mapLimit(items, 6, async (it) => {
  try { return { ...it, reader: readReaderReport(await callReader(buildReaderPrompt(it.content))) }; }
  catch (e) { return { ...it, reader: { read: false, error: String(e?.message || e).slice(0, 160), hardParts: [] } }; }
});

const stat = (group) => {
  const g = out.filter((o) => o.group === group && o.reader.read);
  const by = (u) => g.filter((o) => o.reader.opening === u).length;
  const hard = g.map((o) => o.reader.hardParts.length);
  return {
    n: g.length, unread: out.filter((o) => o.group === group && !o.reader.read).length,
    บอกเรื่อง: by('บอกเรื่อง'), เกริ่น: by('เกริ่น'), งง: by('งง'),
    'สะดุด 0': hard.filter((h) => h === 0).length, 'สะดุด 1': hard.filter((h) => h === 1).length, 'สะดุด 2+': hard.filter((h) => h >= 2).length,
    'ผ่าน (บอกเรื่อง+สะดุด≤1)': g.filter((o) => o.reader.clear).length,
    'ผ่านถ้าเข้ม (สะดุด 0)': g.filter((o) => o.reader.opening === 'บอกเรื่อง' && o.reader.hardParts.length === 0).length,
  };
};
const summary = { tag: TAG, model: MODEL, effort: EFFORT, teacher: stat('teacher'), system: stat('system') };
writeJson(outPath(`reader-calibrate-${TAG}.json`), { summary, items: out.map(({ content, ...rest }) => ({ ...rest, opening: content.split(/\n\s*\n/)[0] })) });
console.table({ ครู: summary.teacher, [`ระบบ ${TAG}`]: summary.system });
