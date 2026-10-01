#!/usr/bin/env node
// 🧪 fake-codex.mjs — ตัวปลอม `codex exec` สำหรับข้อสอบ codexRunner (ไม่ยิง AI จริง ไม่เผาโควตา)
// รับอาร์กิวเมนต์แบบ codex จริง (-C <workdir> -o <outfile> ... -) + พรอมต์ทาง stdin แล้วทำตาม FAKE_CODEX_MODE:
//   ok        เขียน <workdir>/out/result.json จาก FAKE_CODEX_RESULT (path) หรือผลตัวอย่างในตัว · เขียน -o · พิมพ์ tokens used
//   no-file   ไม่เขียน result.json แต่ข้อความสุดท้าย (-o) มี JSON ในโค้ดเฟนซ์
//   quota     ออกโค้ด 1 พร้อม stderr "usage limit reached"
//   auth-ok0  ออกโค้ด 0 · ข้อความสุดท้าย "Not logged in" (CLI หลุดล็อกอินแต่ตอบสำเร็จ)
//   noisy     เขียน result.json สำเร็จ แต่ stderr มีคำว่า 401/authentication (บันทึกงานที่อ่านหน้าเว็บมา) และออกโค้ด 0
// ทุกโหมดเขียน <workdir>/out/seen.json = { argv, envNames, promptHead, promptHasThai } เพื่อพิสูจน์อาร์กิวเมนต์/env/UTF-8
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const workdir = at('-C') || process.cwd();
const outFile = at('-o');
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  const prompt = Buffer.concat(chunks).toString('utf8');
  const outDir = path.join(workdir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'seen.json'), JSON.stringify({
    argv: args,
    envNames: Object.keys(process.env).sort(),
    codexHome: process.env.CODEX_HOME || null,
    toolsRoot: process.env.RESEARCH_TOOLS_REPO_ROOT || null,
    promptHead: prompt.slice(0, 200),
    promptHasThai: /[\u0E00-\u0E7F]/.test(prompt),
    promptLength: prompt.length,
  }));
  const mode = process.env.FAKE_CODEX_MODE || 'ok';
  const sample = process.env.FAKE_CODEX_RESULT ? fs.readFileSync(process.env.FAKE_CODEX_RESULT, 'utf8') : JSON.stringify({
    complexity: 'ต่ำ', plan: [{ question: 'ต้นทางคือโพสต์ใด', why_valuable: 'กันข่าวเก่า', decided: 'ค้น', reason: 'ไม่มีลิงก์' }],
    origin_post: { url: null, source_name: '', date: 'ไม่ทราบ', confidence: 0 }, story_date_estimate: 'ไม่ทราบ', stale_news_warning: null,
    cards: [], raw_corrections: [], flags: ['ORIGIN_NOT_FOUND'], skipped: [], tool_log: [{ tool: 'serper', args: 'x', ok: true, note: '', ms: 900 }],
  });
  if (mode === 'quota') { process.stderr.write('ERROR: usage limit reached for this plan\n'); process.exit(1); }
  if (mode === 'auth-ok0') {
    if (outFile) fs.writeFileSync(outFile, 'Not logged in · Please run codex login', 'utf8');
    process.stdout.write('codex\nNot logged in\n');
    process.exit(0);
  }
  if (mode === 'no-file') {
    if (outFile) fs.writeFileSync(outFile, `สรุปงาน\n\`\`\`json\n${sample}\n\`\`\`\n`, 'utf8');
    process.stdout.write('codex\nเสร็จ\ntokens used\n2,048\n');
    process.exit(0);
  }
  fs.writeFileSync(path.join(outDir, 'result.json'), sample, 'utf8');
  if (outFile) fs.writeFileSync(outFile, 'บันทึกผลแล้วที่ out/result.json', 'utf8');
  if (mode === 'noisy') process.stderr.write('exec: fetched page says HTTP 401 authentication required for comments\n');
  process.stderr.write('tokens used\n12,345\n');
  process.stdout.write('codex\nบันทึกผลแล้ว\n');
  process.exit(0);
});
