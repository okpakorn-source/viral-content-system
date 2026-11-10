// ขั้น 2.2 ของชุดทดลอง: "ผู้กำหนดทิศทางข่าว" — ใช้ต้นแบบ 33 ปก (data/angle-exemplars/angle-library.json) เลือกประเด็นที่ชูให้แต่ละข่าว
// ทำก่อนเลือกครูและก่อนเขียนเสมอ (เจ้าของสั่ง 10 พ.ย. 69: ต้นแบบกำหนดทิศทาง · ครู/คลังพรอมต์เป็นตัวเสริมสำนวน)
// รัน: node scripts/teacher-trial/direct.mjs        ผล: scratch/teacher-trial/angles.json   (เรียกโมเดล 1 ครั้งต่อข่าว · ข่าวที่ทำแล้วไม่ยิงซ้ำ)
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import { outPath, readJson, writeJson, loadEnvKeys, mapLimit } from './common.mjs';
import { loadAngleExemplars, directAngle } from '../../src/lib/services/angleDirector.js';

loadEnvKeys(['ANTHROPIC_API_KEY']);
const MODEL = process.env.TEACHER_DIRECTOR_MODEL || process.env.TEACHER_WRITER_MODEL || 'claude-opus-4-8';
const client = new Anthropic();
const usage = { calls: 0, input: 0, output: 0 };

// งานตัดสินใจว่าจะชูอะไร = งานคิด: เปิดให้คิดก่อนตอบ + effort สูง
async function callDirector({ system, user }) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: process.env.TEACHER_DIRECTOR_EFFORT || 'high' },
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

const exemplars = loadAngleExemplars();
const cases = readJson(outPath('cases.json'));
const outFile = outPath('angles.json');
const done = !process.argv.includes('--redo') && fs.existsSync(outFile) ? readJson(outFile) : {};

await mapLimit(cases.filter((c) => !done[c.caseId]), 4, async (c) => {
  const brief = await directAngle({ rawText: c.rawText, exemplars, callModel: callDirector });
  done[c.caseId] = brief;
  const top = brief.angles[0];
  console.log(`#${c.caseId} ${brief.ok ? '✔' : '✖ ' + (brief.error || '')} ${brief.angles.length} ทิศทาง${top ? ' | ' + top.coverLines.join(' / ').slice(0, 110) : ''}`);
});
writeJson(outFile, done);
const all = Object.values(done);
console.log(`\nกำหนดทิศทางแล้ว ${all.filter((b) => b.ok).length}/${cases.length} ข่าว · ทิศทางรวม ${all.reduce((s, b) => s + b.angles.length, 0)} · เรียกโมเดล ${usage.calls} ครั้ง (เข้า ${usage.input} ออก ${usage.output} โทเคน)`);
