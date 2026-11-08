#!/usr/bin/env node
// 🛡️ ตรวจสวิตช์ env ให้ตรง "ยุคปัง" ของระบบข่าว (12 มิ.ย.–10 ก.ค. 69)
// วิธีใช้:
//   npx vercel env pull .env.prod-check --environment=production   (ดึงค่าจริงจาก Vercel production)
//   node scripts/check-golden-env.mjs .env.prod-check
//   (ไม่ระบุไฟล์ = อ่านจาก process.env ปัจจุบัน)
// ผล: ตารางทุกตัวแปรที่ท่อข่าวยุคปัง + ชั้นคิว "อ่านจริง" พร้อมคำตัดสิน · exit 1 ถ้ามีตัวที่เบี่ยงจากยุคปัง
import fs from 'node:fs';

// ── รายการสวิตช์ที่โค้ดอ่านจริง (สแกน process.env.* ในไฟล์ข่าวยุคปัง + src/lib/ai/era + ชั้นคิว/บอท 23 ส.ค. 69)
// expect: 'unset' = ยุคปังไม่ตั้ง (ใช้ค่าในโค้ด) · ค่าอื่น = ค่าที่ถือว่าเท่ายุคปัง · allow = ค่าที่ยอมรับได้เพิ่ม
const GOLDEN = [
  // --- ท่อเขียนข่าวยุคปัง (ห้ามเบี่ยง) ---
  { name: 'CLAUDE_WRITE_MODEL',   expect: 'unset', allow: ['claude-opus-4-8'], meaning: 'โมเดลนักเขียน — ยุคปัง = claude-opus-4-8 (ไม่ตั้ง = ค่านี้)' , critical: true },
  { name: 'CLAUDE_WRITE_EFFORT',  expect: 'unset', allow: ['medium'],          meaning: 'effort ของนักเขียน — ยุคปัง = medium', critical: true },
  { name: 'GEN_ANGLES',           expect: 'unset', allow: ['3'],               meaning: 'จำนวนมุมต่อข่าว — ยุคปัง = 3', critical: true },
  { name: 'GEN_PER_ANGLE',        expect: 'unset', allow: ['1'],               meaning: 'เวอร์ชันต่อมุม — ยุคปัง = 1', critical: true },
  { name: 'SKIP_CORRECTION',      expect: 'unset', allow: ['false'],           meaning: 'ข้ามด่านแก้หลังเขียน — ยุคปังไม่ข้าม', critical: true },
  { name: 'WITHTIMEOUT_ABORT',    expect: 'unset', allow: [],                  meaning: 'โหมด abort ของ withTimeout — ยุคปังไม่ตั้ง', critical: false },
  { name: 'SUPABASE_DISABLED',    expect: 'unset', allow: ['0', 'false'],      meaning: 'ปิด Supabase (จะตกไป fallback ไฟล์) — ต้องไม่ตั้ง', critical: true },
  { name: 'SUPABASE_RESILIENCE_MODE', expect: 'unset', allow: [],              meaning: 'โหมดทนทาน Supabase (โครงสร้าง)', critical: false },
  { name: 'SUPABASE_REST_TIMEOUT_MS', expect: 'unset', allow: [],              meaning: 'timeout Supabase (โครงสร้าง)', critical: false },
  // --- ชั้นคิว/ตัวส่งงาน (คงรุ่นปัจจุบันไว้ — ค่าที่แนะนำให้ใกล้ยุคปัง) ---
  { name: 'TEXT_ONLY_MODE',       expect: 'unset', allow: ['0', '1'],          meaning: 'ไม่ตั้ง/1 = รับเฉพาะข้อความ (เจ้าของเคาะ 16 ก.ค.) · 0 = รับลิงก์ด้วยเหมือนยุคปัง — เจ้าของเคาะ', critical: false },
  { name: 'QUEUE_TIMEOUT_RESCUE', expect: 'cover-only', allow: ['unset'],      meaning: 'แนะนำ cover-only: ข่าวเกิน 770 วิ = failed ทันทีแบบยุคปัง (ไม่ตั้ง = รอ route รายงาน ซึ่ง route ยุคปังไม่ทำ → ค้าง 15 นาที)', critical: false },
  { name: 'QUEUE_NEWS_DEADLINE_MS', expect: 'unset', allow: [],                meaning: 'เพดานเวลางานข่าวใน worker (default 770000)', critical: false },
  { name: 'QUEUE_FETCH_LONG_AGENT', expect: 'unset', allow: ['0', '1'],        meaning: 'dispatcher fetch ยาว (โครงสร้าง)', critical: false },
  { name: 'QUEUE_SELF_BASE_URL',  expect: 'unset', allow: ['*'],               meaning: 'origin ที่ worker เรียกตัวเอง (กัน 401 SSO)', critical: false },
  { name: 'QUEUE_LOCAL_NEWS',     expect: 'unset', allow: ['0'],               meaning: 'ให้เครื่องทีมรันข่าว — บน Vercel ต้องไม่ตั้ง', critical: false },
  { name: 'QUEUE_COVER_ON_VERCEL', expect: 'unset', allow: ['0'],              meaning: 'ให้ Vercel รันปก — ต้องไม่ตั้ง', critical: false },
  { name: 'QUEUE_ATOMIC_CLAIM',   expect: 'unset', allow: ['1'],               meaning: 'atomic claim คิว (โครงสร้าง)', critical: false },
  // --- สวิตช์ยุคใหม่ที่โค้ดยุคปัง "ไม่อ่านแล้ว" — ตั้งไว้ก็ไม่มีผล แต่ควรลบกันสับสน ---
  ...['VIRAL_SHORTLIST', 'VIRAL_SHORTLIST_K', 'VIRAL_MATCH_MODE', 'VIRAL_STYLE_PACK', 'VIRAL_ROTATE', 'VIRAL_HITS_FORMULA', 'VIRAL_TEACHER_GUIDE', 'VIRAL_EXAMPLE_CHARS', 'LEGACY_LENGTH_RULES', 'LENGTH_BY_CONTENT', 'ALLOW_LEGACY_AUTO', 'PROMPT_VARIETY_BAND', 'GEMINI_TEXT_MODEL', 'CARD_PICKER_AI', 'CARD_CATALOG_ALL', 'CARD_PICKER_MODEL', 'MODEL_BREAKDOWN', 'MODEL_BLUEPRINT', 'ENDING_MODE', 'STYLE_PACK_V2', 'FORCE_LESSON_ANGLE', 'ALLOW_SIMULATION', 'FEELING_ECHO', 'WITNESS_FACTLOCK', 'RAW_FACT_COMPLETENESS_GATE', 'NEWS_RESEARCH', 'ANGLE_MIN_MATCH_SCORE', 'DESK_PIPELINE']
    .map(n => ({ name: n, expect: 'unset', allow: [], meaning: 'สวิตช์ยุค ก.ค.16–ส.ค. — โค้ดยุคปังไม่อ่าน (ไม่มีผล) ควรลบ', critical: false, ignored: true })),
];

function loadEnvFile(p) {
  const env = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return env;
}
const file = process.argv[2];
const env = file ? loadEnvFile(file) : process.env;
const src = file ? `ไฟล์ ${file}` : 'process.env ปัจจุบัน';

let bad = 0, warn = 0;
const rows = [];
for (const g of GOLDEN) {
  const raw = env[g.name];
  const val = raw === undefined || raw === '' ? 'unset' : String(raw);
  let verdict;
  if (val === g.expect) verdict = '✅ ตรงยุคปัง';
  else if (g.allow.includes(val) || g.allow.includes('*')) verdict = g.ignored ? '⚠️ ตั้งไว้แต่ไม่มีผล' : '✅ ยอมรับได้';
  else if (g.ignored) { verdict = '⚠️ ตั้งไว้แต่โค้ดยุคปังไม่อ่าน — ควรลบ'; warn++; }
  else if (g.critical) { verdict = '🔴 เบี่ยงจากยุคปัง — ต้องแก้'; bad++; }
  else { verdict = '🟡 ต่างจากที่แนะนำ — ดูความหมาย'; warn++; }
  rows.push({ name: g.name, value: /SECRET|KEY|TOKEN/.test(g.name) ? (val === 'unset' ? 'unset' : '<ซ่อน>') : val, expect: g.expect, verdict, meaning: g.meaning });
}
console.log(`\n🛡️ ตรวจสวิตช์ env เทียบ "ยุคปัง" — แหล่ง: ${src}\n`);
const w = Math.max(...rows.map(r => r.name.length));
for (const r of rows) console.log(`${r.name.padEnd(w)}  ค่า=${String(r.value).padEnd(12)} คาดหวัง=${String(r.expect).padEnd(11)} ${r.verdict}  — ${r.meaning}`);
console.log(`\nสรุป: 🔴 ต้องแก้ ${bad} · 🟡/⚠️ ควรดู ${warn} · ตัวแปรที่โค้ดยุคปังอ่านทั้งหมด = ${GOLDEN.filter(g => !g.ignored).length} ตัว (คีย์ API ไม่รวม)`);
console.log('หมายเหตุ: ตัวแปรอื่นใดที่ไม่อยู่ในรายการนี้ ไม่มีผลกับท่อเขียนข่าวยุคปัง (คลิป/ปก/company มีสวิตช์ของตัวเอง)');
process.exit(bad ? 1 : 0);
