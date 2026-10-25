// 🧭 ข้อสอบพฤติกรรม (25 ต.ค. 69 · ผู้ตรวจรอบ 3 ข้อ 6): สาย URL/polish (teacherGuideEligible=false) ต้องไม่โดน
//   "ปิดคลังครู" และ "ตัวจับคู่ความหมาย" ของสาย TEXT — ข้อสอบเดิมเทียบแค่ regex ในซอร์ส (กลายพันธุ์ให้รั่วแล้วไม่แดง)
// วิธี: รัน getViralFewshotBlock ตัวจริง · ฐานข้อมูลปลอม (คืนครู 6 ใบ ไม่ต่อเน็ต) · สอดแนม matchTeachers ว่าถูกเรียกไหม
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REAL_TCM = pathToFileURL(join(ROOT, 'src', 'lib', 'services', 'teacherConceptMatch.js')).href;
const BODY = 'พยาบาลสาวจอดรถลงไปช่วยชายที่หมดสติกลางถนน ปั๊มหัวใจต่อเนื่องจนรถพยาบาลมาถึง คนที่ผ่านไปมาช่วยกันโบกรถ เรื่องนี้ทำให้หลายคนชื่นชมน้ำใจ '.repeat(3);
globalThis.__TEACHER_ROWS = Array.from({ length: 6 }, (_, i) => ({
  id: `t${i + 1}`, title: i === 0 ? 'พยาบาลปั๊มหัวใจช่วยชีวิตคนแปลกหน้า' : `ครูตัวอย่างใบที่ ${i + 1} เรื่องน้ำใจ`,
  content: BODY, writing_notes: '', category: 'ช่วยเหลือกัน', engagement_likes: 100 - i,
}));
globalThis.__TCM_CALLS = 0;
const FAKE_SB = `
const rows = () => globalThis.__TEACHER_ROWS;
function chain() {
  const q = { select: () => q, order: () => q, limit: () => q, eq: () => q,
    insert: async () => ({ error: null }),
    then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej) };
  return q;
}
export function getSupabase() { return { from: () => chain() }; }
export default { getSupabase };`;
const SPY_TCM = `import * as real from '${REAL_TCM}';
export * from '${REAL_TCM}';
export function matchTeachers(...a) { globalThis.__TCM_CALLS += 1; return real.matchTeachers(...a); }`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = String(context.parentURL || '');
    if (specifier === '../supabase.js' && parent.includes('viralFewshot')) return { url: `data:text/javascript,${encodeURIComponent(FAKE_SB)}`, shortCircuit: true };
    if (specifier === './teacherConceptMatch.js' && parent.includes('viralFewshot')) return { url: `data:text/javascript,${encodeURIComponent(SPY_TCM)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { getViralFewshotBlock } = await import('../src/lib/services/viralFewshot.js');

const ENV_KEYS = ['VIRAL_TEACHERS', 'VIRAL_SHORTLIST', 'TEACHER_CONCEPT_MATCH', 'VIRAL_MATCH_MODE', 'VIRAL_STYLE_PACK'];
async function run(env, args) {
  const keep = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  const log = console.log; console.log = () => {};
  globalThis.__TCM_CALLS = 0;
  try {
    const block = await getViralFewshotBlock({ category: 'ช่วยเหลือกัน', newsTitle: 'พยาบาลจอดรถช่วยคนหมดสติ ปั๊มหัวใจ', newsBrief: { coreStory: 'พยาบาลปั๊มหัวใจช่วยชีวิตคนแปลกหน้ากลางถนน' }, ...args });
    return { block, tcm: globalThis.__TCM_CALLS };
  } finally {
    console.log = log;
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const HAS_TEACHER = /โพสต์ไวรัลจริง|--- ตัวอย่าง 1 ---/u;

test('U1 สาย URL ค่าแบบ prod (VIRAL_SHORTLIST=1 · ไม่ตั้งสวิตช์ใหม่): ยังได้ครู · ไม่เรียกตัวจับคู่ความหมาย', async () => {
  const r = await run({ VIRAL_SHORTLIST: '1' }, { teacherGuideEligible: false });
  assert.match(r.block, HAS_TEACHER, 'สาย URL ต้องยังได้ครูเหมือน HEAD');
  assert.equal(r.tcm, 0, 'สาย URL ห้ามเรียก matchTeachers');
});

test('U2 สาย TEXT ค่าเริ่มต้น: ปิดครู (Style Pack ล้วน) · ไม่เรียกตัวจับคู่', async () => {
  const r = await run({ VIRAL_SHORTLIST: '1' }, { teacherGuideEligible: true });
  assert.doesNotMatch(r.block, HAS_TEACHER);
  assert.equal(r.tcm, 0);
});

test('U3 สาย TEXT เปิดครูคืน (VIRAL_TEACHERS=1): ใช้ตัวจับคู่ความหมาย · TEACHER_CONCEPT_MATCH=0 = ตัวคัดโผเดิม (ถอยเท่า HEAD)', async () => {
  const on = await run({ VIRAL_SHORTLIST: '1', VIRAL_TEACHERS: '1' }, { teacherGuideEligible: true });
  assert.ok(on.tcm >= 1, 'ต้องเรียก matchTeachers');
  assert.match(on.block, HAS_TEACHER);
  const off = await run({ VIRAL_SHORTLIST: '1', VIRAL_TEACHERS: '1', TEACHER_CONCEPT_MATCH: '0' }, { teacherGuideEligible: true });
  assert.equal(off.tcm, 0);
  assert.match(off.block, HAS_TEACHER);
});
